import git, { TREE, type HttpClient, type PromiseFsClient } from 'isomorphic-git';
import { mergeNote } from '../merge/note';

const BRANCH = 'master';
const REMOTE_REF = `refs/remotes/origin/${BRANCH}`;
const MAX_ATTEMPTS = 3;

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
	/** Called before the engine writes or deletes a vault file. */
	onWrite?: (path: string) => void;
}

export type Outcome = 'up-to-date' | 'pushed' | 'pulled' | 'merged';

export interface SyncReport {
	outcome: Outcome;
	/** Files changed by bringing in the other device's commits. */
	pulledFiles: string[];
	/** Files both devices changed, merged automatically. */
	mergedFiles: string[];
	/** Merged files where at least one Section was Stacked. */
	stackedFiles: string[];
	/** Copies written as `name (<device>).ext` for non-note files changed on both sides. */
	conflictCopies: string[];
}

type Change = 'added' | 'modified' | 'deleted';

interface Files {
	readFile(path: string): Promise<Uint8Array | string>;
	writeFile(path: string, data: Uint8Array): Promise<void>;
	unlink(path: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

export class SyncEngine {
	private readonly o: EngineOptions;

	constructor(options: EngineOptions) {
		this.o = options;
	}

	/** The few file operations the engine does itself, beyond what isomorphic-git does. */
	private get files(): Files {
		return this.o.fs.promises as unknown as Files;
	}

	private get repo() {
		return { fs: this.o.fs, dir: this.o.dir };
	}

	/** Commit this device's changes, bring in the other device's, push the result. */
	async sync(): Promise<SyncReport> {
		const report = emptyReport();
		await this.commitAll(`sync ${this.o.device}: ${stamp(this.now())}`);
		for (let attempt = 1; ; attempt++) {
			await this.fetch();
			const local = await this.head();
			const remote = await this.resolve(REMOTE_REF);
			if (local === remote) return report;

			if (remote !== null && (await this.isAncestor(local, remote))) {
				await this.fastForward(local, remote, report);
				return { ...report, outcome: 'pulled' };
			}
			if (remote !== null && !(await this.isAncestor(remote, local))) {
				await this.mergeWith(local, remote, report);
				report.outcome = 'merged';
			} else {
				report.outcome = 'pushed';
			}
			if (await this.push()) return report;
			if (attempt >= MAX_ATTEMPTS) throw new Error('GitHub kept rejecting the push');
		}
	}

	/** Bring in the other device's changes, leaving this device's pending edits uncommitted. */
	async pull(): Promise<SyncReport> {
		await this.fetch();
		const local = await this.head();
		const remote = await this.resolve(REMOTE_REF);
		if (local === remote || remote === null) return emptyReport();
		if (await this.isAncestor(local, remote)) {
			const report = emptyReport();
			await this.fastForward(local, remote, report);
			return { ...report, outcome: 'pulled' };
		}
		// Local commits are waiting (an earlier push failed): a full sync handles both sides.
		return this.sync();
	}

	/** True when the vault has edits not yet committed. */
	async hasPendingChanges(): Promise<boolean> {
		return (await this.pendingRows()).length > 0;
	}

	// --- steps -------------------------------------------------------------

	private async commitAll(message: string): Promise<boolean> {
		const rows = await this.pendingRows();
		if (!rows.length) return false;
		for (const [filepath, , workdir] of rows) {
			if (workdir === 0) await git.remove({ ...this.repo, filepath });
			else await git.add({ ...this.repo, filepath });
		}
		await git.commit({ ...this.repo, message, author: this.author() });
		return true;
	}

	private async pendingRows() {
		const matrix = await git.statusMatrix({ ...this.repo });
		return matrix.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1));
	}

	/** Move to the remote commit, merging into any file edited here since `local`. */
	private async fastForward(local: string, remote: string, report: SyncReport): Promise<void> {
		const theirsDevice = await this.deviceOf(remote);
		for (const [path, change] of await this.changes(local, remote)) {
			report.pulledFiles.push(path);
			const committed = await this.readAt(local, path);
			const disk = await this.readDisk(path);
			const theirs = change === 'deleted' ? null : await this.readAt(remote, path);
			const blobOid = theirs === null ? null : await this.blobOid(remote, path);

			if (disk !== null && !sameBytes(disk, committed)) {
				// Edited here and not committed yet: keep the edit, merged with theirs.
				const merged = await this.mergeFile(path, committed, disk, theirs, theirsDevice, report);
				await this.writeDisk(path, merged);
			} else {
				// Unchanged here, or deleted here while the other device edited it: theirs wins.
				await this.writeDisk(path, theirs);
			}

			if (blobOid === null) await git.remove({ ...this.repo, filepath: path });
			else await git.updateIndex({ ...this.repo, filepath: path, oid: blobOid, add: true });
		}
		await git.writeRef({ ...this.repo, ref: `refs/heads/${BRANCH}`, value: remote, force: true });
	}

	/** Join both histories with a merge commit (ADR 0004). */
	private async mergeWith(local: string, remote: string, report: SyncReport): Promise<void> {
		const bases = (await git.findMergeBase({ ...this.repo, oids: [local, remote] })) as string[];
		const baseOid = bases[0] ?? null;
		const theirsDevice = await this.deviceOf(remote);
		const ours = baseOid ? await this.changes(baseOid, local) : new Map<string, Change>();
		const theirs = baseOid ? await this.changes(baseOid, remote) : await this.changes(null, remote);

		for (const path of theirs.keys()) {
			const theirsContent = await this.readAt(remote, path);
			if (!ours.has(path)) {
				report.pulledFiles.push(path);
				const committed = await this.readAt(local, path);
				const disk = await this.readDisk(path);
				if (disk !== null && !sameBytes(disk, committed)) {
					// Typed into since the commit: merge the typing in rather than overwrite it.
					const merged = await this.mergeFile(path, committed, disk, theirsContent, theirsDevice, report);
					await this.writeDisk(path, merged);
				} else {
					await this.writeDisk(path, theirsContent);
				}
			} else {
				const baseContent = baseOid ? await this.readAt(baseOid, path) : null;
				// Re-read the disk: the user may have typed since the commit.
				const oursContent = await this.readDisk(path);
				if (sameBytes(oursContent, theirsContent)) continue;
				const merged = await this.mergeFile(path, baseContent, oursContent, theirsContent, theirsDevice, report);
				await this.writeDisk(path, merged);
			}
			await this.stage(path);
		}
		for (const copy of report.conflictCopies) await this.stage(copy);

		await git.commit({
			...this.repo,
			message: `sync ${this.o.device}: ${stamp(this.now())} (merge)`,
			author: this.author(),
			parent: [local, remote],
		});
	}

	/** Result for a file both sides touched; null means deleted. */
	private async mergeFile(
		path: string,
		base: Uint8Array | null,
		ours: Uint8Array | null,
		theirs: Uint8Array | null,
		theirsDevice: string,
		report: SyncReport,
	): Promise<Uint8Array | null> {
		// An edit always wins over a deletion.
		if (ours === null) return theirs !== null && !sameBytes(theirs, base) ? theirs : null;
		if (theirs === null) return ours;
		if (sameBytes(ours, theirs)) return ours;

		report.mergedFiles.push(path);
		if (!path.endsWith('.md')) {
			const copy = conflictCopyPath(path, theirsDevice);
			await this.writeDisk(copy, theirs);
			report.conflictCopies.push(copy);
			return ours;
		}
		const result = mergeNote(
			{ base: base === null ? null : decode(base), ours: decode(ours), theirs: decode(theirs) },
			{ template: await this.o.templateFor(path), oursDevice: this.o.device, theirsDevice },
		);
		if (result.stacked) report.stackedFiles.push(path);
		return encode(result.text);
	}

	// --- git plumbing ------------------------------------------------------

	private async fetch(): Promise<void> {
		await git.fetch({
			...this.repo,
			http: this.o.http,
			url: this.o.url,
			remote: 'origin',
			ref: BRANCH,
			singleBranch: true,
			tags: false,
			onAuth: () => this.auth(),
		});
	}

	/** Push; false when GitHub rejected it because the other device pushed first. */
	private async push(): Promise<boolean> {
		try {
			const result = await git.push({
				...this.repo,
				http: this.o.http,
				url: this.o.url,
				remote: 'origin',
				ref: BRANCH,
				remoteRef: BRANCH,
				onAuth: () => this.auth(),
			});
			if (!result.ok) return false;
		} catch (e) {
			if (isRejection(e)) return false;
			throw e;
		}
		const local = await this.resolve(BRANCH);
		if (local) await git.writeRef({ ...this.repo, ref: REMOTE_REF, value: local, force: true });
		return true;
	}

	private auth() {
		return { username: 'x-access-token', password: this.o.token };
	}

	private async resolve(ref: string): Promise<string | null> {
		try {
			return await git.resolveRef({ ...this.repo, ref });
		} catch {
			return null;
		}
	}

	private async head(): Promise<string> {
		const oid = await this.resolve(BRANCH);
		if (oid === null) throw new Error(`the vault repository has no ${BRANCH} branch`);
		return oid;
	}

	private async isAncestor(ancestor: string, oid: string): Promise<boolean> {
		if (ancestor === oid) return true;
		return git.isDescendent({ ...this.repo, oid, ancestor, depth: -1 });
	}

	/** Files that differ between two commits (null `from` means the empty tree). */
	private async changes(from: string | null, to: string): Promise<Map<string, Change>> {
		const result = new Map<string, Change>();
		const trees = from === null ? [TREE({ ref: to })] : [TREE({ ref: from }), TREE({ ref: to })];
		await git.walk({
			...this.repo,
			trees,
			map: async (filepath, entries) => {
				if (filepath === '.') return true;
				const [a, b] = from === null ? [null, entries[0]] : entries;
				const aType = a ? await a.type() : undefined;
				const bType = b ? await b.type() : undefined;
				if (aType === 'tree' || bType === 'tree') {
					// Recurse; a file replaced by a folder (or the reverse) shows as its leaves.
					if (aType === 'blob') result.set(filepath, 'deleted');
					if (bType === 'blob') result.set(filepath, 'added');
					return true;
				}
				const aOid = a && aType === 'blob' ? await a.oid() : undefined;
				const bOid = b && bType === 'blob' ? await b.oid() : undefined;
				if (aOid === bOid) return false;
				result.set(filepath, aOid === undefined ? 'added' : bOid === undefined ? 'deleted' : 'modified');
				return false;
			},
		});
		return result;
	}

	private async readAt(commit: string, filepath: string): Promise<Uint8Array | null> {
		try {
			return (await git.readBlob({ ...this.repo, oid: commit, filepath })).blob;
		} catch {
			return null;
		}
	}

	private async blobOid(commit: string, filepath: string): Promise<string | null> {
		try {
			return (await git.readBlob({ ...this.repo, oid: commit, filepath })).oid;
		} catch {
			return null;
		}
	}

	private async deviceOf(commit: string): Promise<string> {
		const { commit: c } = await git.readCommit({ ...this.repo, oid: commit });
		return /^sync (.+?): /.exec(c.message)?.[1] ?? 'other device';
	}

	private async stage(path: string): Promise<void> {
		if ((await this.readDisk(path)) === null) {
			await git.remove({ ...this.repo, filepath: path });
		} else {
			await git.add({ ...this.repo, filepath: path });
		}
	}

	// --- working tree ------------------------------------------------------

	private full(path: string): string {
		return `${this.o.dir.replace(/\/$/, '')}/${path}`;
	}

	private async readDisk(path: string): Promise<Uint8Array | null> {
		try {
			const data = await this.files.readFile(this.full(path));
			return typeof data === 'string' ? encode(data) : new Uint8Array(data);
		} catch {
			return null;
		}
	}

	private async writeDisk(path: string, content: Uint8Array | null): Promise<void> {
		this.o.onWrite?.(path);
		const fsp = this.files;
		if (content === null) {
			try {
				await fsp.unlink(this.full(path));
			} catch {
				// Already gone.
			}
			return;
		}
		await this.mkdirs(path);
		await fsp.writeFile(this.full(path), content);
	}

	private async mkdirs(path: string): Promise<void> {
		const parts = path.split('/').slice(0, -1);
		for (let i = 1; i <= parts.length; i++) {
			try {
				await this.files.mkdir(this.full(parts.slice(0, i).join('/')));
			} catch {
				// Exists.
			}
		}
	}

	private author() {
		const now = this.now();
		return {
			...this.o.author,
			timestamp: Math.floor(now.getTime() / 1000),
			timezoneOffset: now.getTimezoneOffset(),
		};
	}

	private now(): Date {
		return this.o.now?.() ?? new Date();
	}
}

function emptyReport(): SyncReport {
	return { outcome: 'up-to-date', pulledFiles: [], mergedFiles: [], stackedFiles: [], conflictCopies: [] };
}

function stamp(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function conflictCopyPath(path: string, device: string): string {
	const slash = path.lastIndexOf('/');
	const dot = path.lastIndexOf('.');
	return dot > slash + 1 ? `${path.slice(0, dot)} (${device})${path.slice(dot)}` : `${path} (${device})`;
}

function isRejection(e: unknown): boolean {
	const code = (e as { code?: string } | null)?.code;
	return code === 'PushRejectedError' || code === 'GitPushError';
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
	if (a === null || b === null) return a === b;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();
function decode(b: Uint8Array): string {
	return decoder.decode(b);
}
function encode(s: string): Uint8Array {
	return encoder.encode(s);
}
