export type Job = 'sync' | 'pull';

export interface SchedulerOptions {
	quietMs: number;
	pullMs: number;
	/** Timer functions; the plugin passes `window`'s. */
	timers: Timers;
}

export interface Timers {
	setTimeout(fn: () => void, ms: number): number;
	clearTimeout(id: number): void;
	setInterval(fn: () => void, ms: number): number;
	clearInterval(id: number): void;
}

/** Decides when to Sync and Pull; runs one job at a time, queueing at most one more. */
export class Scheduler {
	private quietTimer: number | null = null;
	private pullTimer: number | null = null;
	private running = false;
	private queued: Job | null = null;
	private dirty = false;

	constructor(
		private readonly run: (job: Job) => Promise<void>,
		private readonly options: SchedulerOptions,
	) {}

	start(): void {
		this.pullTimer = this.options.timers.setInterval(() => this.request('pull'), this.options.pullMs);
	}

	stop(): void {
		if (this.pullTimer) this.options.timers.clearInterval(this.pullTimer);
		if (this.quietTimer) this.options.timers.clearTimeout(this.quietTimer);
		this.pullTimer = this.quietTimer = null;
	}

	/** The user edited the vault: restart the Quiet period. */
	edited(): void {
		this.dirty = true;
		if (this.quietTimer) this.options.timers.clearTimeout(this.quietTimer);
		this.quietTimer = this.options.timers.setTimeout(() => this.request('sync'), this.options.quietMs);
	}

	/** The app is going to the background or closing: don't wait for the Quiet period. */
	backgrounded(): void {
		if (this.dirty) this.request('sync');
	}

	/** True when there are edits a Sync hasn't picked up yet. */
	get pending(): boolean {
		return this.dirty;
	}

	request(job: Job): void {
		if (job === 'sync') {
			this.dirty = false;
			if (this.quietTimer) this.options.timers.clearTimeout(this.quietTimer);
			this.quietTimer = null;
		}
		if (this.running) {
			if (this.queued !== 'sync') this.queued = job;
			return;
		}
		this.running = true;
		void this.run(job).finally(() => {
			this.running = false;
			const next = this.queued;
			this.queued = null;
			if (next) this.request(next);
		});
	}
}
