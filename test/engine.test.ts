import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { join } from 'node:path';
import http from 'isomorphic-git/http/node';
import { SyncEngine } from '../src/sync/engine';
import {
	cloneDevice,
	git,
	remoteFile,
	remoteLog,
	seedRemote,
	startGitServer,
	writeFile,
	type GitServer,
} from './helpers/gitServer';

const TEMPLATE = '---\ntype: daily\n---\n\n## Scratchpad\n*Random thoughts*\n\n## Yesterday\n';
const TODAY = '1.journal/0.daily/2026-11-23.md';

let server: GitServer;

function device(name: string, dir: string): SyncEngine {
	return new SyncEngine({
		fs,
		http,
		dir,
		url: server.url,
		token: 'unused',
		device: name,
		author: { name: 'Test', email: 'test@example.com' },
		templateFor: async (path) => (path.startsWith('1.journal/0.daily/') ? TEMPLATE : null),
		now: () => new Date('2026-11-23T10:00:00'),
	});
}

function read(dir: string, path: string): string {
	return fs.readFileSync(join(dir, path), 'utf8');
}

function head(dir: string): string {
	return git(dir, 'rev-parse', 'HEAD').trim();
}

beforeEach(async () => {
	server = await startGitServer();
	seedRemote(server, { '.gitignore': '.obsidian/\n', 'Timeline.md': '# Timeline\n\n- 2010 school\n' });
});
afterEach(async () => {
	await server.close();
});

describe('SyncEngine', () => {
	it('commits and pushes local edits, and the other device pulls them', async () => {
		const desktopDir = cloneDevice(server);
		const phoneDir = cloneDevice(server);
		writeFile(desktopDir, TODAY, TEMPLATE.replace('*Random thoughts*', 'Hello'));
		writeFile(desktopDir, '.obsidian/workspace.json', '{}');

		const report = await device('Desktop', desktopDir).sync();

		expect(report.outcome).toBe('pushed');
		expect(remoteLog(server)[0]).toBe('sync Desktop: 2026-11-23 10:00');
		expect(remoteFile(server, TODAY)).toContain('Hello');
		expect(() => remoteFile(server, '.obsidian/workspace.json')).toThrow();

		const pulled = await device('Phone', phoneDir).pull();
		expect(pulled.outcome).toBe('pulled');
		expect(read(phoneDir, TODAY)).toContain('Hello');
		expect(head(phoneDir)).toBe(head(desktopDir));
	});

	it('lets the real daily note win over a template note the phone created before pulling', async () => {
		const desktopDir = cloneDevice(server);
		const phoneDir = cloneDevice(server);
		const real = TEMPLATE.replace('*Random thoughts*', 'Slept well.');
		writeFile(desktopDir, TODAY, real);
		await device('Desktop', desktopDir).sync();

		writeFile(phoneDir, TODAY, TEMPLATE);
		const report = await device('Phone', phoneDir).sync();

		expect(report.outcome).toBe('merged');
		expect(report.stackedFiles).toEqual([]);
		expect(read(phoneDir, TODAY)).toBe(real);
		expect(remoteFile(server, TODAY)).toBe(real);
		expect(git(phoneDir, 'status', '--porcelain')).toBe('');
	});

	it('stacks a section both devices wrote, naming each device', async () => {
		const desktopDir = cloneDevice(server);
		const phoneDir = cloneDevice(server);
		writeFile(desktopDir, 'Timeline.md', '# Timeline\n\n- 2010 school, desktop\n');
		await device('Desktop', desktopDir).sync();
		writeFile(phoneDir, 'Timeline.md', '# Timeline\n\n- 2010 school, phone\n');

		const report = await device('Phone', phoneDir).sync();

		expect(report.stackedFiles).toEqual(['Timeline.md']);
		expect(remoteFile(server, 'Timeline.md')).toBe(
			'# Timeline\n*— Desktop —*\n- 2010 school, desktop\n\n*— Phone —*\n- 2010 school, phone\n',
		);
		expect(git(server.root + '/journal.git', 'log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2);
	});

	it('merges a pending edit on pull without committing it', async () => {
		const desktopDir = cloneDevice(server);
		const phoneDir = cloneDevice(server);
		writeFile(desktopDir, 'Timeline.md', '# Timeline\n\n- 2010 school\n\n## Later\n- 2020 work\n');
		await device('Desktop', desktopDir).sync();
		writeFile(phoneDir, 'Timeline.md', '# Timeline\n\n- 2005 born\n- 2010 school\n');

		const report = await device('Phone', phoneDir).pull();

		expect(report.outcome).toBe('pulled');
		expect(read(phoneDir, 'Timeline.md')).toBe(
			'# Timeline\n\n- 2005 born\n- 2010 school\n\n## Later\n- 2020 work\n',
		);
		expect(head(phoneDir)).toBe(head(desktopDir));
		expect(git(phoneDir, 'status', '--porcelain').trim()).toBe('M Timeline.md');
	});

	it('keeps both versions of a binary file changed on both devices', async () => {
		const desktopDir = cloneDevice(server);
		const phoneDir = cloneDevice(server);
		writeFile(desktopDir, 'assets/photo.png', new Uint8Array([1, 2, 3]));
		writeFile(phoneDir, 'assets/photo.png', new Uint8Array([9, 9]));
		await device('Desktop', desktopDir).sync();

		const report = await device('Phone', phoneDir).sync();

		expect(report.conflictCopies).toEqual(['assets/photo (Desktop).png']);
		expect([...fs.readFileSync(join(phoneDir, 'assets/photo.png'))]).toEqual([9, 9]);
		expect([...fs.readFileSync(join(phoneDir, 'assets/photo (Desktop).png'))]).toEqual([1, 2, 3]);
	});

	it('keeps an edit over a deletion', async () => {
		const desktopDir = cloneDevice(server);
		const phoneDir = cloneDevice(server);
		fs.unlinkSync(join(desktopDir, 'Timeline.md'));
		await device('Desktop', desktopDir).sync();
		writeFile(phoneDir, 'Timeline.md', '# Timeline\n\n- edited\n');

		await device('Phone', phoneDir).sync();

		expect(remoteFile(server, 'Timeline.md')).toBe('# Timeline\n\n- edited\n');
	});

	it('keeps what the user typed while a sync was running', async () => {
		const desktopDir = cloneDevice(server);
		const phoneDir = cloneDevice(server);
		writeFile(desktopDir, 'Timeline.md', '# Timeline\n\n- 2010 school\n\n## Later\n- 2020 work\n');
		writeFile(desktopDir, 'other.md', 'desktop\n');
		await device('Desktop', desktopDir).sync();

		writeFile(phoneDir, 'phone.md', 'phone\n');
		let typed = false;
		const typingHttp = {
			async request(req: Parameters<typeof http.request>[0]) {
				const res = await http.request(req);
				if (req.method === 'POST' && !typed) {
					// The user types into Timeline.md after the commit, while fetching.
					typed = true;
					writeFile(phoneDir, 'Timeline.md', '# Timeline\n\n- 2005 born\n- 2010 school\n');
				}
				return res;
			},
		};
		const phone = new SyncEngine({ ...device('Phone', phoneDir)['o'], http: typingHttp });
		await phone.sync();

		expect(read(phoneDir, 'Timeline.md')).toBe('# Timeline\n\n- 2005 born\n- 2010 school\n\n## Later\n- 2020 work\n');
	});

	it('reports up-to-date when nothing changed anywhere', async () => {
		const dir = cloneDevice(server);
		expect((await device('Desktop', dir).sync()).outcome).toBe('up-to-date');
	});
});
