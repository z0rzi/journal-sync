import { spawn, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A real git smart-HTTP server (git http-backend) over a bare repo, for tests. */
export interface GitServer {
	url: string;
	root: string;
	close(): Promise<void>;
}

export async function startGitServer(): Promise<GitServer> {
	const root = mkdtempSync(join(tmpdir(), 'jsync-remote-'));
	execFileSync('git', ['init', '-q', '--bare', '-b', 'master', join(root, 'journal.git')]);
	execFileSync('git', ['-C', join(root, 'journal.git'), 'config', 'http.receivepack', 'true']);

	const server: Server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const cgi = spawn('git', ['http-backend'], {
			env: {
				...process.env,
				GIT_PROJECT_ROOT: root,
				GIT_HTTP_EXPORT_ALL: '1',
				PATH_INFO: url.pathname,
				QUERY_STRING: url.search.slice(1),
				REQUEST_METHOD: req.method ?? 'GET',
				CONTENT_TYPE: req.headers['content-type'] ?? '',
				REMOTE_USER: 'test',
			},
		});
		req.pipe(cgi.stdin);
		const chunks: Buffer[] = [];
		cgi.stdout.on('data', (c: Buffer) => chunks.push(c));
		cgi.on('close', () => {
			const out = Buffer.concat(chunks);
			const split = out.indexOf('\r\n\r\n');
			const head = out.subarray(0, split).toString();
			const body = out.subarray(split + 4);
			let status = 200;
			for (const line of head.split('\r\n')) {
				const [name, ...rest] = line.split(':');
				const value = rest.join(':').trim();
				if (!name) continue;
				if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0]);
				else res.setHeader(name, value);
			}
			res.statusCode = status;
			res.end(body);
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}/journal.git`,
		root,
		close: () => new Promise((r) => server.close(() => r())),
	};
}

/** Seed the remote with files, as if pushed by obsidian-git. */
export function seedRemote(server: GitServer, files: Record<string, string>): void {
	const work = mkdtempSync(join(tmpdir(), 'jsync-seed-'));
	git(work, 'init', '-q', '-b', 'master');
	for (const [path, content] of Object.entries(files)) writeFile(work, path, content);
	git(work, 'add', '-A');
	git(work, 'commit', '-q', '-m', 'vault backup: seed');
	git(work, 'push', '-q', join(server.root, 'journal.git'), 'master');
}

/** A device's existing clone of the vault, made with real git like today's. */
export function cloneDevice(server: GitServer): string {
	const dir = mkdtempSync(join(tmpdir(), 'jsync-device-'));
	execFileSync('git', ['clone', '-q', join(server.root, 'journal.git'), dir]);
	// Today's origin is SSH, which the plugin never uses: it is given an HTTPS url.
	git(dir, 'remote', 'set-url', 'origin', 'git@github.com:z0rzi/journal.git');
	return dir;
}

export function remoteFile(server: GitServer, path: string): string {
	return execFileSync('git', ['-C', join(server.root, 'journal.git'), 'show', `master:${path}`]).toString();
}

export function remoteLog(server: GitServer): string[] {
	return execFileSync('git', ['-C', join(server.root, 'journal.git'), 'log', '--format=%s', 'master'])
		.toString()
		.trim()
		.split('\n');
}

export function git(dir: string, ...args: string[]): string {
	return execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]).toString();
}

export function writeFile(dir: string, path: string, content: string | Uint8Array): void {
	const full = join(dir, path);
	mkdirSync(join(full, '..'), { recursive: true });
	writeFileSync(full, content);
}
