import { PluginSettingTab, SecretComponent, Setting, type App } from 'obsidian';
import type JournalSyncPlugin from './main';

export interface JournalSyncSettings {
	deviceName: string;
	/** Id of the GitHub token in Obsidian's secret storage. */
	tokenSecret: string;
	/** HTTPS url of the repository; empty means the HTTPS form of `origin`. */
	remoteUrl: string;
	authorName: string;
	authorEmail: string;
	quietMinutes: number;
	pullMinutes: number;
}

export const DEFAULT_SETTINGS: JournalSyncSettings = {
	deviceName: '',
	tokenSecret: '',
	remoteUrl: '',
	authorName: '',
	authorEmail: '',
	quietMinutes: 10,
	pullMinutes: 10,
};

export class JournalSyncSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: JournalSyncPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = async () => {
			await this.plugin.saveSettings();
		};

		new Setting(containerEl)
			.setName('Device name')
			.setDesc('Names this device in commit messages and above stacked sections.')
			.addText((t) =>
				t.setValue(s.deviceName).onChange(async (v) => {
					s.deviceName = v.trim();
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('GitHub token')
			.setDesc('Fine-grained token with read and write access to the contents of the journal repository only.')
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(s.tokenSecret).onChange(async (v) => {
					s.tokenSecret = v ?? '';
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('Repository URL')
			.setDesc('Leave empty to use the HTTPS form of the vault’s origin remote.')
			.addText((t) =>
				t
					.setPlaceholder('https://github.com/owner/repo.git')
					.setValue(s.remoteUrl)
					.onChange(async (v) => {
						s.remoteUrl = v.trim();
						await save();
					}),
			);

		new Setting(containerEl).setName('Commit author name').addText((t) =>
			t.setValue(s.authorName).onChange(async (v) => {
				s.authorName = v.trim();
				await save();
			}),
		);
		new Setting(containerEl).setName('Commit author email').addText((t) =>
			t.setValue(s.authorEmail).onChange(async (v) => {
				s.authorEmail = v.trim();
				await save();
			}),
		);

		const minutes = (name: string, desc: string, key: 'quietMinutes' | 'pullMinutes') =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t.setValue(String(s[key])).onChange(async (v) => {
						const n = Number(v);
						if (!Number.isFinite(n) || n < 1) return;
						s[key] = n;
						await save();
						this.plugin.restartScheduler();
					}),
				);
		minutes('Quiet period (minutes)', 'Sync this long after the last edit.', 'quietMinutes');
		minutes('Pull interval (minutes)', 'Bring in the other device’s changes this often.', 'pullMinutes');
	}
}
