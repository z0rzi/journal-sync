import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scheduler, type Job } from '../src/sync/scheduler';

const MIN = 60_000;
let runs: Job[];
let release: (() => void) | null;
let scheduler: Scheduler;

beforeEach(() => {
	vi.useFakeTimers();
	runs = [];
	release = null;
	scheduler = new Scheduler(
		(job) => {
			runs.push(job);
			return new Promise<void>((r) => (release = r));
		},
		{
			quietMs: 10 * MIN,
			pullMs: 10 * MIN,
			timers: {
				setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
				clearTimeout: (id) => clearTimeout(id),
				setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
				clearInterval: (id) => clearInterval(id),
			},
		},
	);
});
afterEach(() => {
	scheduler.stop();
	vi.useRealTimers();
});

async function finish() {
	release?.();
	release = null;
	await vi.advanceTimersByTimeAsync(0);
}

describe('Scheduler', () => {
	it('syncs once the vault has been quiet for the quiet period', async () => {
		scheduler.edited();
		await vi.advanceTimersByTimeAsync(9 * MIN);
		scheduler.edited();
		await vi.advanceTimersByTimeAsync(9 * MIN);
		expect(runs).toEqual([]);
		await vi.advanceTimersByTimeAsync(1 * MIN);
		expect(runs).toEqual(['sync']);
	});

	it('pulls on the pull interval', async () => {
		scheduler.start();
		await vi.advanceTimersByTimeAsync(10 * MIN);
		expect(runs).toEqual(['pull']);
	});

	it('syncs right away when the app goes to the background with pending edits', async () => {
		scheduler.backgrounded();
		expect(runs).toEqual([]);
		scheduler.edited();
		scheduler.backgrounded();
		expect(runs).toEqual(['sync']);
		await finish();
		await vi.advanceTimersByTimeAsync(10 * MIN);
		expect(runs).toEqual(['sync']);
	});

	it('runs one job at a time and queues a single follow-up, a sync beating a pull', async () => {
		scheduler.request('pull');
		scheduler.request('pull');
		scheduler.request('sync');
		scheduler.request('pull');
		expect(runs).toEqual(['pull']);
		await finish();
		expect(runs).toEqual(['pull', 'sync']);
		await finish();
		expect(runs).toEqual(['pull', 'sync']);
	});
});
