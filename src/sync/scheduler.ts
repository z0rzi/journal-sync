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

/** Decides when to Sync and Pull, and runs one job at a time with at most one waiting. */
export class Scheduler {
	private quietTimer: number | null = null;
	private pullTimer: number | null = null;
	private running: Promise<void> | null = null;
	private waiting: { job: Job; done: Promise<void> } | null = null;
	/** Edits no Sync has picked up yet. */
	private edits = false;

	constructor(
		private readonly run: (job: Job) => Promise<void>,
		private readonly options: SchedulerOptions,
	) {}

	start(): void {
		this.pullTimer = this.options.timers.setInterval(() => void this.request('pull'), this.options.pullMs);
	}

	stop(): void {
		if (this.pullTimer !== null) this.options.timers.clearInterval(this.pullTimer);
		this.cancelQuietTimer();
		this.pullTimer = null;
	}

	/** The user edited the vault: restart the Quiet period. */
	edited(): void {
		this.edits = true;
		this.cancelQuietTimer();
		this.quietTimer = this.options.timers.setTimeout(() => void this.request('sync'), this.options.quietMs);
	}

	/** True when there are edits no Sync has picked up yet. */
	get hasEdits(): boolean {
		return this.edits;
	}

	/** The app is going to the background or closing: don't wait for the Quiet period. */
	backgrounded(): Promise<void> {
		return this.edits ? this.request('sync') : Promise.resolve();
	}

	/** Run a job, or queue it behind the running one; resolves once it has run. */
	request(job: Job): Promise<void> {
		if (job === 'sync') {
			this.edits = false;
			this.cancelQuietTimer();
		}
		if (!this.running) return this.runNow(job);
		if (this.waiting) {
			// One waiting job is enough; a Sync also does everything a Pull does.
			if (job === 'sync') this.waiting.job = 'sync';
			return this.waiting.done;
		}
		const waiting: { job: Job; done: Promise<void> } = {
			job,
			done: this.running.catch(() => undefined).then(() => {
				this.waiting = null;
				return this.runNow(waiting.job);
			}),
		};
		this.waiting = waiting;
		return waiting.done;
	}

	private runNow(job: Job): Promise<void> {
		const running = this.run(job).finally(() => {
			if (this.running === running) this.running = null;
		});
		this.running = running;
		return running;
	}

	private cancelQuietTimer(): void {
		if (this.quietTimer !== null) this.options.timers.clearTimeout(this.quietTimer);
		this.quietTimer = null;
	}
}
