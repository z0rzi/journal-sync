import fs from 'node:fs';
import { join } from 'node:path';
import type { DataAdapter } from 'obsidian';

/** The slice of Obsidian's DataAdapter that adapterFs uses, over a real folder. */
export function fakeAdapter(root: string): DataAdapter {
	const full = (p: string) => join(root, p);
	const adapter = {
		exists: async (p: string) => fs.existsSync(full(p)),
		stat: async (p: string) => {
			if (!fs.existsSync(full(p))) return null;
			const s = fs.statSync(full(p));
			return { type: s.isDirectory() ? 'folder' : 'file', ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
		},
		read: async (p: string) => fs.readFileSync(full(p), 'utf8'),
		readBinary: async (p: string) => {
			const b = fs.readFileSync(full(p));
			return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
		},
		write: async (p: string, data: string) => fs.writeFileSync(full(p), data),
		writeBinary: async (p: string, data: ArrayBuffer) => fs.writeFileSync(full(p), new Uint8Array(data)),
		remove: async (p: string) => fs.unlinkSync(full(p)),
		mkdir: async (p: string) => fs.mkdirSync(full(p), { recursive: true }),
		rmdir: async (p: string) => fs.rmdirSync(full(p)),
		list: async (p: string) => {
			const entries = fs.readdirSync(full(p), { withFileTypes: true });
			const path = (name: string) => (p ? `${p}/${name}` : name);
			return {
				files: entries.filter((e) => !e.isDirectory()).map((e) => path(e.name)),
				folders: entries.filter((e) => e.isDirectory()).map((e) => path(e.name)),
			};
		},
	};
	return adapter as unknown as DataAdapter;
}
