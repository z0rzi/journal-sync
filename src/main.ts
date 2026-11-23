// eslint-disable-next-line import/no-nodejs-modules -- the npm `buffer` polyfill, not Node's module
import { Buffer } from 'buffer';
import { MarkdownView, Notice, Platform, Plugin, type TAbstractFile } from 'obsidian';
import { SyncStatus } from './obsidian/statusBar';
import { createEngine } from './obsidian/vaultEngine';
import { DEFAULT_SETTINGS, JournalSyncSettingTab, type JournalSyncSettings } from './settings';
import type { SyncReport } from './sync/engine';
import { Scheduler, type Job } from './sync/scheduler';

// isomorphic-git expects Node's Buffer, which the phone doesn't have.
(window as { Buffer?: unknown }).Buffer ??= Buffer;

const OFFLINE = /net::|ENOTFOUND|ECONN|EAI_AGAIN|ETIMEDOUT|Failed to fetch/i;

export default class JournalSyncPlugin extends Plugin {
	settings: JournalSyncSettings = { ...DEFAULT_SETTINGS };
	private scheduler: Scheduler | null = null;
	private status: SyncStatus | null = null;
	private lastError: string | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new JournalSyncSettingTab(this.app, this));

		const statusEl = this.addStatusBarItem();
		this.status = new SyncStatus(statusEl);
		this.registerDomEvent(statusEl, 'click', () => void this.scheduler?.request('sync'));
		this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => void this.scheduler?.request('sync') });

		this.app.workspace.onLayoutReady(() => this.startSyncing());
	}

	onunload(): void {
		this.scheduler?.stop();
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<JournalSyncSettings> | null) };
		this.settings.deviceName ||= Platform.isMobile ? 'Phone' : 'Desktop';
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Apply changed intervals, keeping any edits not synced yet. */
	restartScheduler(): void {
		const old = this.scheduler;
		old?.stop();
		this.scheduler = new Scheduler((job) => this.runJob(job), {
			quietMs: this.settings.quietMinutes * 60_000,
			pullMs: this.settings.pullMinutes * 60_000,
			timers: window,
		});
		this.scheduler.start();
		if (old?.hasEdits) this.scheduler.edited();
	}

	private startSyncing(): void {
		this.restartScheduler();
		// Registered once the layout is ready: Obsidian fires `create` for every file while loading.
		const edited = (file: TAbstractFile) => {
			if (!file.path.startsWith(`${this.app.vault.configDir}/`)) this.scheduler?.edited();
		};
		this.registerEvent(this.app.vault.on('modify', edited));
		this.registerEvent(this.app.vault.on('create', edited));
		this.registerEvent(this.app.vault.on('delete', edited));
		this.registerEvent(this.app.vault.on('rename', edited));
		// The main window's document: backgrounding the app hides it.
		const main = activeDocument;
		this.registerDomEvent(main, 'visibilitychange', () => {
			if (main.visibilityState === 'visible') void this.scheduler?.request('pull');
			else void this.scheduler?.backgrounded();
		});
		this.registerEvent(
			this.app.workspace.on('quit', (tasks) => {
				const scheduler = this.scheduler;
				if (scheduler) tasks.add(() => scheduler.backgrounded());
			}),
		);
		void this.scheduler?.request('pull');
	}

	private async runJob(job: Job): Promise<void> {
		this.status?.syncing();
		try {
			await this.saveOpenNotes();
			const engine = await createEngine(this.app, this.settings);
			this.announce(job === 'sync' ? await engine.sync() : await engine.pull());
			this.lastError = null;
			this.status?.done();
		} catch (e) {
			console.error('journal-sync', e);
			const message = e instanceof Error ? e.message : String(e);
			if (!navigator.onLine || OFFLINE.test(message)) {
				this.status?.offline();
			} else {
				this.status?.failed(message);
				if (message !== this.lastError) new Notice(`Journal sync failed: ${message}`, 10_000);
				this.lastError = message;
			}
			// Edits may still be uncommitted or unpushed: try again after another Quiet period.
			if (job === 'sync') this.scheduler?.edited();
		}
	}

	/** Write editors' unsaved text to disk first, so the engine sees it and an editor can't overwrite a merge. */
	private async saveOpenNotes(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView) await leaf.view.save();
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
}
