import { describe, expect, it } from 'vitest';
import { httpsRemote, templatePathFor } from '../src/vault';

describe('httpsRemote', () => {
	it('turns a GitHub SSH remote into its HTTPS form', () => {
		expect(httpsRemote('git@github.com:z0rzi/journal.git')).toBe('https://github.com/z0rzi/journal.git');
		expect(httpsRemote('ssh://git@github.com/z0rzi/journal.git')).toBe('https://github.com/z0rzi/journal.git');
	});
	it('leaves an HTTPS remote alone', () => {
		expect(httpsRemote('https://github.com/z0rzi/journal.git')).toBe('https://github.com/z0rzi/journal.git');
	});
});

describe('templatePathFor', () => {
	const folders = [
		{ folder: '1.journal/0.daily', template: '9.templates/0.daily.md' },
		{ folder: '1.journal', template: '9.templates/generic' },
	];
	it('picks the most specific Templater folder template', () => {
		expect(templatePathFor('1.journal/0.daily/2026-11-23.md', folders)).toBe('9.templates/0.daily.md');
		expect(templatePathFor('1.journal/x.md', folders)).toBe('9.templates/generic.md');
	});
	it('has no template outside those folders, or for a folder only sharing a prefix', () => {
		expect(templatePathFor('Timeline.md', folders)).toBeNull();
		expect(templatePathFor('1.journal-old/x.md', folders)).toBeNull();
	});
});
