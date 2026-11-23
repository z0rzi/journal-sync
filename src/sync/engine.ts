import git, { TREE, type HttpClient, type PromiseFsClient } from 'isomorphic-git';
import type { Versions } from '../merge/lines';
import { mergeNote } from '../merge/note';

const BRANCH = 'master';
const REMOTE_BRANCH = `refs/remotes/origin/${BRANCH}`;
/** Times the cycle runs again when GitHub rejects the push because the other device pushed first. */
const MAX_RETRIES = 3;

export interface EngineOptions {
	fs: PromiseFsClient;
	http: HttpClient;
	/** Vault root, which is also the git working directory. */
	dir: string;
	/** HTTPS url of the GitHub repository. */
	url: string;
	token: string;
	device: string;
	author: { name: string; email: string };
	/** Raw template a note at this path is created from, if any. */
	templateFor: (path: string) => Promise<string | null>;
	now?: () => Date;
}

export type Outcome = 'up-to-date' | 'pushed' | 'pulled' | 'merged';

export interface SyncReport {
	outcome: Outcome;
	/** Notes where at least one Section was Stacked. */
	stackedFiles: string[];
	/** Copies written as `name (<device>).ext` for other files both devices changed. */
	conflictCopies: string[];
}

/** File content; null when the file doesn't exist. */
type Content = Uint8Array | null;

/** The few file operations the engine does itself, beyond isomorphic-git's. */
interface Files {
	readFile(path: string): Promise<Uint8Array | string>;
	writeFile(path: string, data: Uint8Array): Promise<void>;
	unlink(path: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

export class SyncEngine {
	constructor(private readonly options: EngineOptions) {}

	/** Commit this device's changes, bring in the other device's, push the result. */
	async sync(): Promise<SyncReport> {
		const report = newReport();
		await this.commitPending();
		for (let retry = 0; retry <= MAX_RETRIES; retry++) {
			const { local, remote } = await this.fetch();
			if (local === remote) return report;
			if (await this.isAncestor(local, remote)) {
				await this.fastForward(local, remote, report);
				return { ...report, outcome: 'pulled' };
			}
			if (await this.isAncestor(remote, local)) {
				report.outcome = 'pushed';
			} else {
				await this.mergeWith(local, remote, report);
				report.outcome = 'merged';
			}
			if (await this.push()) return report;
		}
		throw new Error('GitHub kept rejecting the push');
	}

	/** Bring in the other device's changes without committing this device's pending edits. */
	async pull(): Promise<SyncReport> {
		const report = newReport();
		const { local, remote } = await this.fetch();
		if (local === remote) return report;
		if (await this.isAncestor(local, remote)) {
			await this.fastForward(local, remote, report);
			return { ...report, outcome: 'pulled' };
		}
		// Commits from an earlier, failed push are waiting.
		if ((await this.isAncestor(remote, local)) && (await this.push())) return { ...report, outcome: 'pushed' };
		// Both sides have commits: only a full Sync can join them.
		return this.sync();
	}

	// --- the steps ---------------------------------------------------------

	private async commitPending(): Promise<void> {
		const matrix = await git.statusMatrix(this.repo);
		const pending = matrix.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1));
		if (!pending.length) return;
		for (const [filepath, , workdir] of pending) {
			if (workdir === 0) await git.remove({ ...this.repo, filepath });
			else await git.add({ ...this.repo, filepath });
		}
		await git.commit({ ...this.repo, message: syncMessage(this.options.device, this.now()), author: this.author() });
	}

	/** Move to the remote commit. Pending edits stay on disk, merged, and uncommitted. */
	private async fastForward(local: string, remote: string, report: SyncReport): Promise<void> {
		for (const path of await this.bringIn(local, remote, report)) {
			const blob = await this.readAt(remote, path);
			if (blob) await git.updateIndex({ ...this.repo, filepath: path, oid: blob.oid, add: true });
			else await git.remove({ ...this.repo, filepath: path });
		}
		await git.writeRef({ ...this.repo, ref: `refs/heads/${BRANCH}`, value: remote, force: true });
	}

	/** Join both histories with a merge commit (ADR 0004). */
	private async mergeWith(local: string, remote: string, report: SyncReport): Promise<void> {
		const [base] = (await git.findMergeBase({ ...this.repo, oids: [local, remote] })) as string[];
		for (const path of await this.bringIn(base ?? null, remote, report)) await this.stage(path);
		for (const path of report.conflictCopies) await this.stage(path);
		await git.commit({
			...this.repo,
			message: syncMessage(this.options.device, this.now(), 'merge'),
			author: this.author(),
			parent: [local, remote],
		});
	}

	/**
	 * Write to disk every file the remote changed since `base`, merged with what
	 * is on disk now: that covers this device's commits and anything typed
	 * since. Returns the paths it looked at.
	 */
	private async bringIn(base: string | null, remote: string, report: SyncReport): Promise<string[]> {
		const theirsDevice = deviceFromMessage((await git.readCommit({ ...this.repo, oid: remote })).commit.message);
		const paths = await this.changedPaths(base, remote);
		for (const path of paths) {
			const disk = await this.readDisk(path);
			const merged = await this.mergeFile(path, theirsDevice, report, {
				base: base === null ? null : ((await this.readAt(base, path))?.blob ?? null),
				ours: disk,
				theirs: (await this.readAt(remote, path))?.blob ?? null,
			});
			if (!sameContent(merged, disk)) await this.writeDisk(path, merged);
		}
		return paths;
	}

	private async mergeFile(path: string, theirsDevice: string, report: SyncReport, v: Versions<Content>): Promise<Content> {
		if (sameContent(v.ours, v.base) || sameContent(v.ours, v.theirs)) return v.theirs;
		if (sameContent(v.theirs, v.base)) return v.ours;
		// An edit always wins over a deletion.
		if (v.ours === null || v.theirs === null) return v.ours ?? v.theirs;

		if (!path.endsWith('.md')) {
			const copy = conflictCopyPath(path, theirsDevice);
			await this.writeDisk(copy, v.theirs);
			report.conflictCopies.push(copy);
			return v.ours;
		}
		const result = mergeNote(
			{ base: v.base === null ? null : decode(v.base), ours: decode(v.ours), theirs: decode(v.theirs) },
			{ template: await this.options.templateFor(path), oursDevice: this.options.device, theirsDevice },
		);
		if (result.stacked) report.stackedFiles.push(path);
		return encode(result.text);
	}

	// --- git ---------------------------------------------------------------

	private get repo() {
		return { fs: this.options.fs, dir: this.options.dir };
	}

	private get remote() {
		return {
			http: this.options.http,
			url: this.options.url,
			remote: 'origin',
			onAuth: () => ({ username: 'x-access-token', password: this.options.token }),
		};
	}

	private async fetch(): Promise<{ local: string; remote: string }> {
		await git.fetch({ ...this.repo, ...this.remote, ref: BRANCH, singleBranch: true, tags: false });
		const [local, remote] = await Promise.all([BRANCH, REMOTE_BRANCH].map((ref) => git.resolveRef({ ...this.repo, ref })));
		return { local: local as string, remote: remote as string };
	}

	/** Push; false when GitHub rejected it because the other device pushed first. */
	private async push(): Promise<boolean> {
		try {
			const result = await git.push({ ...this.repo, ...this.remote, ref: BRANCH, remoteRef: BRANCH });
			if (!result.ok) return false;
		} catch (e) {
			const code = (e as { code?: string }).code;
			if (code === 'PushRejectedError' || code === 'GitPushError') return false;
			throw e;
		}
		const local = await git.resolveRef({ ...this.repo, ref: BRANCH });
		await git.writeRef({ ...this.repo, ref: REMOTE_BRANCH, value: local, force: true });
		return true;
	}

	/** True when `ancestor` is `oid` or comes before it. */
	private async isAncestor(ancestor: string, oid: string): Promise<boolean> {
		return ancestor === oid || git.isDescendent({ ...this.repo, oid, ancestor, depth: -1 });
	}

	/** Files that differ between two commits; a null `from` is the empty tree. */
	private async changedPaths(from: string | null, to: string): Promise<string[]> {
		const changed: string[] = [];
		const trees = from === null ? [TREE({ ref: to })] : [TREE({ ref: from }), TREE({ ref: to })];
		await git.walk({
			...this.repo,
			trees,
			map: async (filepath, entries) => {
				const [a, b] = from === null ? [null, entries[0]] : entries;
				const [aType, bType] = [await a?.type(), await b?.type()];
				if (aType === 'tree' || bType === 'tree') {
					// A file replaced by a folder, or the reverse, changes at this path too.
					if (filepath !== '.' && (aType === 'blob' || bType === 'blob')) changed.push(filepath);
					return true;
				}
				if ((await a?.oid()) !== (await b?.oid())) changed.push(filepath);
				return false;
			},
		});
		return changed;
	}

	private async readAt(commit: string, filepath: string): Promise<{ oid: string; blob: Uint8Array } | null> {
		try {
			return await git.readBlob({ ...this.repo, oid: commit, filepath });
		} catch {
			return null;
		}
	}

	private async stage(path: string): Promise<void> {
		if ((await this.readDisk(path)) === null) await git.remove({ ...this.repo, filepath: path });
		else await git.add({ ...this.repo, filepath: path });
	}

	private author() {
		const now = this.now();
		return { ...this.options.author, timestamp: Math.floor(now.getTime() / 1000), timezoneOffset: now.getTimezoneOffset() };
	}

	private now(): Date {
		return this.options.now?.() ?? new Date();
	}

	// --- the working tree --------------------------------------------------

	private get files(): Files {
		return this.options.fs.promises as unknown as Files;
	}

	private pathOnDisk(path: string): string {
		return `${this.options.dir.replace(/\/$/, '')}/${path}`;
	}

	private async readDisk(path: string): Promise<Content> {
		try {
			const data = await this.files.readFile(this.pathOnDisk(path));
			return typeof data === 'string' ? encode(data) : new Uint8Array(data);
		} catch {
			return null;
		}
	}

	private async writeDisk(path: string, content: Content): Promise<void> {
		if (content === null) {
			await this.files.unlink(this.pathOnDisk(path)).catch(() => undefined);
			return;
		}
		const folders = path.split('/').slice(0, -1);
		for (let i = 1; i <= folders.length; i++) {
			await this.files.mkdir(this.pathOnDisk(folders.slice(0, i).join('/'))).catch(() => undefined);
		}
		await this.files.writeFile(this.pathOnDisk(path), content);
	}
}

// --- commit messages: how each device learns the other one's name ----------

function syncMessage(device: string, date: Date, kind?: 'merge'): string {
	const p = (n: number) => String(n).padStart(2, '0');
	const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
	return `sync ${device}: ${stamp}${kind ? ` (${kind})` : ''}`;
}

function deviceFromMessage(message: string): string {
	return /^sync (.+?): /.exec(message)?.[1] ?? 'other device';
}

// --- helpers ----------------------------------------------------------------

function newReport(): SyncReport {
	return { outcome: 'up-to-date', stackedFiles: [], conflictCopies: [] };
}

function conflictCopyPath(path: string, device: string): string {
	const dot = path.lastIndexOf('.');
	const hasExtension = dot > path.lastIndexOf('/') + 1;
	return hasExtension ? `${path.slice(0, dot)} (${device})${path.slice(dot)}` : `${path} (${device})`;
}

function sameContent(a: Content, b: Content): boolean {
	if (a === null || b === null) return a === b;
	return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const encode = (text: string) => new TextEncoder().encode(text);
