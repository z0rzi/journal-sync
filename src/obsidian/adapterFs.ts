import type { DataAdapter } from 'obsidian';

/**
 * The phone has no Node `fs`: give isomorphic-git one backed by Obsidian's
 * DataAdapter. Paths arrive as "/<vault-relative path>" (the engine's dir is "/").
 */
export function adapterFs(adapter: DataAdapter) {
	const rel = (p: string) => p.replace(/^\/+/, '').replace(/\/+$/, '');
	const fail = (code: string, p: string): never => {
		const e = new Error(`${code}: ${p}`) as Error & { code: string };
		e.code = code;
		throw e;
	};
	const statOf = async (p: string) => {
		const path = rel(p);
		const s = path === '' ? { type: 'folder' as const, ctime: 0, mtime: 0, size: 0 } : await adapter.stat(path);
		if (!s) return fail('ENOENT', p);
		const dir = s.type === 'folder';
		return {
			isFile: () => !dir,
			isDirectory: () => dir,
			isSymbolicLink: () => false,
			mode: dir ? 0o40000 : 0o100644,
			size: s.size,
			ino: 0,
			uid: 0,
			gid: 0,
			dev: 0,
			ctimeMs: s.ctime,
			mtimeMs: s.mtime,
		};
	};

	return {
		promises: {
			async readFile(p: string, opts?: { encoding?: string } | string) {
				const path = rel(p);
				if (!(await adapter.exists(path))) return fail('ENOENT', p);
				const encoding = typeof opts === 'string' ? opts : opts?.encoding;
				if (encoding === 'utf8') return adapter.read(path);
				return new Uint8Array(await adapter.readBinary(path));
			},
			async writeFile(p: string, data: Uint8Array | string) {
				const path = rel(p);
				if (typeof data === 'string') return adapter.write(path, data);
				const copy = new Uint8Array(data.byteLength);
				copy.set(data);
				return adapter.writeBinary(path, copy.buffer);
			},
			async unlink(p: string) {
				const path = rel(p);
				if (!(await adapter.exists(path))) return fail('ENOENT', p);
				await adapter.remove(path);
			},
			async readdir(p: string) {
				const path = rel(p);
				const s = path === '' ? { type: 'folder' } : await adapter.stat(path);
				if (!s) return fail('ENOENT', p);
				if (s.type !== 'folder') return fail('ENOTDIR', p);
				const list = await adapter.list(path);
				return [...list.files, ...list.folders].map((f) => f.slice(path ? path.length + 1 : 0));
			},
			async mkdir(p: string) {
				const path = rel(p);
				if (await adapter.exists(path)) return fail('EEXIST', p);
				await adapter.mkdir(path);
			},
			async rmdir(p: string) {
				await adapter.rmdir(rel(p), false);
			},
			stat: statOf,
			lstat: statOf,
			async readlink(p: string): Promise<never> {
				return fail('ENOENT', p);
			},
			async symlink(_target: string, p: string): Promise<never> {
				return fail('EPERM', p);
			},
			async chmod() {},
		},
	};
}
