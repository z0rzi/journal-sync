import git, { type PromiseFsClient } from 'isomorphic-git';
import { FileSystemAdapter, Platform, type App } from 'obsidian';
import type { JournalSyncSettings } from '../settings';
import { SyncEngine } from '../sync/engine';
import { httpsRemote, templatePathFor, type FolderTemplate } from '../vault';
import { adapterFs } from './adapterFs';
import { obsidianHttp } from './http';

/** A SyncEngine for this vault, from this device's settings. */
export async function createEngine(app: App, settings: JournalSyncSettings): Promise<SyncEngine> {
	const token = settings.tokenSecret ? app.secretStorage.getSecret(settings.tokenSecret) : null;
	if (!token) throw new Error('no GitHub token set in Journal Sync settings');

	const { fs, dir } = vaultFiles(app);
	return new SyncEngine({
		fs,
		dir,
		http: obsidianHttp,
		url: settings.remoteUrl || (await originUrl(fs, dir)),
		token,
		device: settings.deviceName,
		author: {
			name: settings.authorName || settings.deviceName,
			email: settings.authorEmail || 'journal-sync@localhost',
		},
		templateFor: (path) => templateFor(app, path),
	});
}

/** Node's fs on the desktop, which is much faster; the vault adapter on the phone (ADR 0001). */
function vaultFiles(app: App): { fs: PromiseFsClient; dir: string } {
	const adapter = app.vault.adapter;
	if (Platform.isDesktopApp && adapter instanceof FileSystemAdapter) {
		// eslint-disable-next-line import/no-nodejs-modules, no-undef, @typescript-eslint/no-require-imports -- desktop only
		return { fs: require('fs') as PromiseFsClient, dir: adapter.getBasePath() };
	}
	return { fs: adapterFs(adapter), dir: '/' };
}

async function originUrl(fs: PromiseFsClient, dir: string): Promise<string> {
	const origin = (await git.getConfig({ fs, dir, path: 'remote.origin.url' })) as string | undefined;
	if (!origin) throw new Error('the vault has no origin remote: set the repository URL in Journal Sync settings');
	return httpsRemote(origin);
}

/** The template Templater would create this note from, read from Templater's folder templates. */
async function templateFor(app: App, path: string): Promise<string | null> {
	const adapter = app.vault.adapter;
	try {
		const templater = JSON.parse(
			await adapter.read(`${app.vault.configDir}/plugins/templater-obsidian/data.json`),
		) as { folder_templates?: FolderTemplate[] };
		const template = templatePathFor(path, templater.folder_templates ?? []);
		return template && (await adapter.exists(template)) ? await adapter.read(template) : null;
	} catch {
		return null;
	}
}
