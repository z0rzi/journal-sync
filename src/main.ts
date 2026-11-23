// eslint-disable-next-line import/no-nodejs-modules -- the npm `buffer` polyfill, not Node's module
import { Buffer } from 'buffer';
import git, { type PromiseFsClient } from 'isomorphic-git';
import { FileSystemAdapter, Notice, Platform, Plugin, type TAbstractFile } from 'obsidian';
import { adapterFs } from './obsidian/adapterFs';
import { obsidianHttp } from './obsidian/http';
import { DEFAULT_SETTINGS, JournalSyncSettingTab, type JournalSyncSettings } from './settings';
import { SyncEngine, type SyncReport } from './sync/engine';
import { Scheduler, type Job } from './sync/scheduler';
import { httpsRemote, templatePathFor, type FolderTemplate } from './vault';

// isomorphic-git expects Node's Buffer, which the phone doesn't have.
(window as { Buffer?: unknown }).Buffer ??= Buffer;

/** Our own writes show up as vault events; ignore those for a moment. */
const OWN_WRITE_GRACE_MS = 5000;

export default class JournalSyncPlugin extends Plugin {
	settings: JournalSyncSettings = { ...DEFAULT_SETTINGS };
	private scheduler: Scheduler | null = null;
	private statusEl: HTMLElement | null = null;
	private ownWrites = new Map<string, number>();
	private lastError: string | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new JournalSyncSettingTab(this.app, this));

		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass('mod-clickable');
		this.registerDomEvent(this.statusEl, 'click', () => this.scheduler?.request('sync'));
		this.setStatus('idle');

		this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => this.scheduler?.request('sync') });
		this.addCommand({ id: 'pull-now', name: 'Pull now', callback: () => this.scheduler?.request('pull') });

		this.app.workspace.onLayoutReady(() => {
			this.restartScheduler();
			// Registered after load: Obsidian fires `create` for every file while loading.
			const edited = (file: TAbstractFile) => this.onVaultEvent(file.path);
			this.registerEvent(this.app.vault.on('modify', edited));
			this.registerEvent(this.app.vault.on('create', edited));
			this.registerEvent(this.app.vault.on('delete', edited));
			this.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					this.onVaultEvent(oldPath);
					this.onVaultEvent(file.path);
				}),
			);
			this.registerDomEvent(document, 'visibilitychange', () => {
				if (document.visibilityState === 'visible') this.scheduler?.request('pull');
				else this.scheduler?.backgrounded();
			});
			this.registerEvent(
				this.app.workspace.on('quit', (tasks) => {
					if (this.scheduler?.pending) tasks.add(() => this.runJob('sync'));
				}),
			);
			this.scheduler?.request('pull');
		});
	}

	onunload(): void {
		this.scheduler?.stop();
	}

	async loadSettings(): Promise<void> {
		const saved = ((await this.loadData()) ?? {}) as Partial<JournalSyncSettings>;
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
		if (!this.settings.deviceName) this.settings.deviceName = Platform.isMobile ? 'Phone' : 'Desktop';
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	restartScheduler(): void {
		const pending = this.scheduler?.pending ?? false;
		this.scheduler?.stop();
		this.scheduler = new Scheduler((job) => this.runJob(job), {
			quietMs: this.settings.quietMinutes * 60_000,
			pullMs: this.settings.pullMinutes * 60_000,
			timers: window,
		});
		this.scheduler.start();
		if (pending) this.scheduler.edited();
	}

	private onVaultEvent(path: string): void {
		const at = this.ownWrites.get(path);
		if (at !== undefined && Date.now() - at < OWN_WRITE_GRACE_MS) return;
		if (path.startsWith('.git/') || path.startsWith(`${this.app.vault.configDir}/`)) return;
		this.scheduler?.edited();
	}

	private async runJob(job: Job): Promise<void> {
		this.setStatus('syncing');
		try {
			const engine = await this.engine();
			const report = job === 'sync' ? await engine.sync() : await engine.pull();
			this.lastError = null;
			this.setStatus('done');
			this.announce(report);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			const offline = !navigator.onLine || /net::|ENOTFOUND|ECONN|EAI_AGAIN|ETIMEDOUT|Failed to fetch/i.test(message);
			this.setStatus(offline ? 'offline' : 'error', message);
			if (!offline && message !== this.lastError) new Notice(`Journal sync failed: ${message}`, 10000);
			this.lastError = message;
			// Edits are still uncommitted or unpushed: try again after another Quiet period.
			if (job === 'sync') this.scheduler?.edited();
			console.error('journal-sync', e);
		}
	}

	private announce(report: SyncReport): void {
		const lines: string[] = [];
		if (report.stackedFiles.length) {
			lines.push('Both devices wrote the same sections. Both versions were kept in:', ...report.stackedFiles);
		}
		if (report.conflictCopies.length) {
			lines.push('Both devices changed these files. The other version was saved as:', ...report.conflictCopies);
		}
		if (lines.length) new Notice(lines.join('\n'), 0);
	}

	private async engine(): Promise<SyncEngine> {
		const token = this.settings.tokenSecret ? this.app.secretStorage.getSecret(this.settings.tokenSecret) : null;
		if (!token) throw new Error('no GitHub token set in Journal Sync settings');

		const adapter = this.app.vault.adapter;
		let fs: PromiseFsClient;
		let dir: string;
		if (Platform.isDesktopApp && adapter instanceof FileSystemAdapter) {
			// Desktop only: Node's fs is much faster than going through the vault adapter.
			// eslint-disable-next-line import/no-nodejs-modules, no-undef, @typescript-eslint/no-require-imports
			fs = require('fs') as PromiseFsClient;
			dir = adapter.getBasePath();
		} else {
			fs = adapterFs(adapter);
			dir = '/';
		}

		let url = this.settings.remoteUrl;
		if (!url) {
			const origin = (await git.getConfig({ fs, dir, path: 'remote.origin.url' })) as string | undefined;
			if (!origin) throw new Error('the vault has no origin remote, set the repository URL in settings');
			url = httpsRemote(origin);
		}

		return new SyncEngine({
			fs,
			http: obsidianHttp,
			dir,
			url,
			token,
			device: this.settings.deviceName,
			author: {
				name: this.settings.authorName || this.settings.deviceName,
				email: this.settings.authorEmail || 'journal-sync@localhost',
			},
			templateFor: (path) => this.templateFor(path),
			onWrite: (path) => this.ownWrites.set(path, Date.now()),
		});
	}

	private async templateFor(path: string): Promise<string | null> {
		const adapter = this.app.vault.adapter;
		const settingsPath = `${this.app.vault.configDir}/plugins/templater-obsidian/data.json`;
		try {
			const templater = JSON.parse(await adapter.read(settingsPath)) as { folder_templates?: FolderTemplate[] };
			const template = templatePathFor(path, templater.folder_templates ?? []);
			return template && (await adapter.exists(template)) ? await adapter.read(template) : null;
		} catch {
			return null;
		}
	}

	private setStatus(state: 'idle' | 'syncing' | 'done' | 'offline' | 'error', detail?: string): void {
		if (!this.statusEl) return;
		const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		const text = {
			idle: 'Sync: waiting',
			syncing: 'Sync: syncing…',
			done: `Sync: ${time}`,
			offline: `Sync: offline (${time})`,
			error: 'Sync: error',
		}[state];
		this.statusEl.setText(text);
		this.statusEl.setAttribute('aria-label', detail ?? 'Click to sync now');
	}
}
