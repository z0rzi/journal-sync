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

type TextSetting = 'deviceName' | 'remoteUrl' | 'authorName' | 'authorEmail';
type MinutesSetting = 'quietMinutes' | 'pullMinutes';

export class JournalSyncSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: JournalSyncPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		this.containerEl.empty();
		this.text('deviceName', 'Device name', 'Names this device in commit messages and above stacked sections.');
		new Setting(this.containerEl)
			.setName('GitHub token')
			.setDesc('Fine-grained token with read and write access to the contents of the journal repository only.')
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(this.plugin.settings.tokenSecret).onChange(async (id) => {
					this.plugin.settings.tokenSecret = id ?? '';
					await this.plugin.saveSettings();
				}),
			);
		this.text('remoteUrl', 'Repository URL', 'Leave empty to use the HTTPS form of the vault’s origin remote.');
		this.text('authorName', 'Commit author name', 'Defaults to the device name.');
		this.text('authorEmail', 'Commit author email', '');
		this.minutes('quietMinutes', 'Quiet period (minutes)', 'Sync this long after the last edit.');
		this.minutes('pullMinutes', 'Pull interval (minutes)', 'Bring in the other device’s changes this often.');
	}

	private text(key: TextSetting, name: string, desc: string): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((t) =>
				t.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value.trim();
					await this.plugin.saveSettings();
				}),
			);
	}

	private minutes(key: MinutesSetting, name: string, desc: string): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((t) =>
				t.setValue(String(this.plugin.settings[key])).onChange(async (value) => {
					const minutes = Number(value);
					if (!Number.isFinite(minutes) || minutes < 1) return;
					this.plugin.settings[key] = minutes;
					await this.plugin.saveSettings();
					this.plugin.restartScheduler();
				}),
			);
	}
}
