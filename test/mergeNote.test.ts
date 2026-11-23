import { describe, expect, it } from 'vitest';
import { mergeNote } from '../src/merge/note';

const TEMPLATE = `---
date: <% tp.date.now("YYYY-MM-DD") %>
type: daily
mood:
---

\`\`\`tasks
GET
\`\`\`

## Scratchpad
*Random thoughts, can stay empty*

## What are we doing today?
*Drop a list of ideas or plans*

## A few thoughts about yesterday
`;

/** What Templater produces when today's note is created on a device. */
const FRESH = TEMPLATE.replace('<% tp.date.now("YYYY-MM-DD") %>', '2026-11-23');

const ctx = { template: TEMPLATE, oursDevice: 'Phone', theirsDevice: 'Desktop' };

function count(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

describe('mergeNote', () => {
	it('merges edits made in different places without stacking', () => {
		const base = 'a\nb\nc\nd\ne\n';
		const result = mergeNote({ base, ours: 'A\nb\nc\nd\ne\n', theirs: 'a\nb\nc\nd\nE\n' }, ctx);
		expect(result).toEqual({ text: 'A\nb\nc\nd\nE\n', stacked: false });
	});

	it('lets the real note win over a template note the phone created before pulling', () => {
		const real = FRESH.replace('*Random thoughts, can stay empty*', 'Slept badly.').replace(
			'## A few thoughts about yesterday\n',
			'## A few thoughts about yesterday\nGood dinner with friends.\n',
		);
		const result = mergeNote({ base: null, ours: FRESH, theirs: real }, ctx);
		expect(result).toEqual({ text: real, stacked: false });
	});

	it('keeps what the phone typed into its template note and what the desktop wrote elsewhere', () => {
		const phone = FRESH.replace('*Random thoughts, can stay empty*', 'Idea on the bus.');
		const desktop = FRESH.replace(
			'## A few thoughts about yesterday\n',
			'## A few thoughts about yesterday\nGood dinner.\n',
		);
		const result = mergeNote({ base: null, ours: phone, theirs: desktop }, ctx);
		expect(result.stacked).toBe(false);
		expect(result.text).toBe(`---
date: 2026-11-23
type: daily
mood:
---

\`\`\`tasks
GET
\`\`\`

## Scratchpad
Idea on the bus.

## What are we doing today?
*Drop a list of ideas or plans*

## A few thoughts about yesterday
Good dinner.
`);
		expect(count(result.text, '```tasks')).toBe(1);
	});

	it('stacks a section both devices wrote differently, the GitHub version first', () => {
		const phone = FRESH.replace('*Random thoughts, can stay empty*', 'From the phone.');
		const desktop = FRESH.replace('*Random thoughts, can stay empty*', 'From the desktop.');
		const result = mergeNote({ base: FRESH, ours: phone, theirs: desktop }, ctx);
		expect(result.stacked).toBe(true);
		expect(result.text).toContain(
			'## Scratchpad\n*— Desktop —*\nFrom the desktop.\n\n*— Phone —*\nFrom the phone.\n\n## What are we doing today?',
		);
	});

	it('never duplicates a code block when stacking', () => {
		const base = '## Notes\nstart\n';
		const block = '```dataview\nLIST\n```\n';
		const ours = `## Notes\n${block}mine\n`;
		const theirs = `## Notes\n${block}theirs\n`;
		const result = mergeNote({ base, ours, theirs }, ctx);
		expect(result.stacked).toBe(true);
		expect(count(result.text, '```dataview')).toBe(1);
		expect(result.text).toContain('mine');
		expect(result.text).toContain('theirs');
	});

	it('merges frontmatter field by field, the GitHub side winning a real clash', () => {
		const base = FRESH;
		const ours = FRESH.replace('mood:', 'mood: 7').replace('type: daily', 'type: daily\nweather: rain');
		const theirs = FRESH.replace('mood:', 'mood: 5').replace(
			'## A few thoughts about yesterday\n',
			'## A few thoughts about yesterday\nok\n',
		);
		const result = mergeNote({ base, ours, theirs }, ctx);
		expect(result.text.startsWith('---\ndate: 2026-11-23\ntype: daily\nweather: rain\nmood: 5\n---\n')).toBe(true);
		expect(result.text).toContain('## A few thoughts about yesterday\nok\n');
	});

	it('keeps a section only this device added, after the section it followed', () => {
		const base = '## One\n1\n\n## Two\n2\n';
		const ours = '## One\n1\n\n## Mine\nnew\n\n## Two\n2\n';
		const theirs = '## One\nuno\n\n## Two\n2\n\n## Theirs\nx\n';
		const result = mergeNote({ base, ours, theirs }, ctx);
		expect(result.text).toBe('## One\nuno\n\n## Mine\nnew\n\n## Two\n2\n\n## Theirs\nx\n');
	});

	it('ignores heading-looking lines inside code blocks', () => {
		const base = '## A\n```bash\n# comment\n```\nx\n';
		const ours = '## A\n```bash\n# comment\n```\nmine\n';
		const theirs = '## A\n```bash\n# comment\n```\ntheirs\n';
		const result = mergeNote({ base, ours, theirs }, ctx);
		expect(count(result.text, '## A')).toBe(1);
		expect(count(result.text, '# comment')).toBe(1);
	});

	it('never duplicates a code block, even when the line merge is clean', () => {
		const base = 'a\nb\nc\nd\ne\nf\n';
		const block = '```tasks\nGET\n```\n';
		const ours = `${block}a\nb\nc\nd\ne\nf\n`;
		const theirs = `a\nb\nc\nd\ne\nf\n${block}`;
		const result = mergeNote({ base, ours, theirs }, ctx);
		expect(count(result.text, '```tasks')).toBe(1);
	});

	it('drops a frontmatter field the GitHub side deleted and this device left alone', () => {
		const base = '---\na: 1\nb: 2\n---\n\n## X\nbase\n';
		const ours = '---\na: 1\nb: 2\n---\n\n## X\nmine\n';
		const theirs = '---\na: 1\n---\n\n## X\ntheirs\n';
		const result = mergeNote({ base, ours, theirs }, ctx);
		expect(result.text.startsWith('---\na: 1\n---\n')).toBe(true);
	});

	it('never treats a template section holding Templater code as blank', () => {
		const template = '## Roles\n<%* tR += "**Role** — " %>\n\n## The week\n_Three lines._\n';
		const ours = '## Roles\n**Writer** — wrote two pages\n\n## The week\n_Three lines._\n';
		const theirs = '## Roles\n**Writer** — \n\n## The week\nCalm week.\n';
		const result = mergeNote(
			{ base: null, ours, theirs },
			{ template, oursDevice: 'Phone', theirsDevice: 'Desktop' },
		);
		expect(result.text).toContain('wrote two pages');
		expect(result.text).toContain('Calm week.');
	});

	it('keeps an edit over a deletion', () => {
		const base = '## A\n1\n\n## B\n2\n';
		const ours = '## A\n1\n';
		const theirs = '## A\n1\n\n## B\nchanged\n';
		expect(mergeNote({ base, ours, theirs }, ctx).text).toBe(theirs);
	});
});
