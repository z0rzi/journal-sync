/** The status bar item: last sync time, or what went wrong. */
export class SyncStatus {
	constructor(private readonly el: HTMLElement) {
		el.addClass('mod-clickable');
		this.show('Sync: waiting', 'Click to sync now');
	}

	syncing(): void {
		this.show('Sync: syncing…', 'Syncing with GitHub');
	}

	done(): void {
		this.show(`Sync: ${clock()}`, 'Click to sync now');
	}

	offline(): void {
		this.show(`Sync: offline (${clock()})`, 'Will retry on the next sync or pull');
	}

	failed(message: string): void {
		this.show('Sync: error', message);
	}

	private show(text: string, tooltip: string): void {
		this.el.setText(text);
		this.el.setAttribute('aria-label', tooltip);
	}
}

function clock(): string {
	return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
