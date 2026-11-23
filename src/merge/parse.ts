/** A heading line with the text under it, up to the next heading of any level. */
export interface Section {
	/** The heading line, plus its occurrence number when the heading repeats. */
	key: string;
	heading: string;
	/** Text under the heading, trimmed. */
	body: string;
}

export interface Note {
	/** Frontmatter fields in order: field name -> its raw lines. Null when there is none. */
	frontmatter: Map<string, string> | null;
	/** Text above the first heading, frontmatter excluded, trimmed. */
	preamble: string;
	sections: Section[];
}

export interface CodeBlock {
	/** First and last line index, both fences included. */
	start: number;
	end: number;
	text: string;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^#{1,6}\s/;
const FIELD = /^([^\s#:-][^:]*):/;

export function parseNote(text: string): Note {
	let lines = text.replace(/\r\n/g, '\n').split('\n');
	let frontmatter: Map<string, string> | null = null;
	const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
	if (end > 0) {
		frontmatter = parseFrontmatter(lines.slice(1, end));
		lines = lines.slice(end + 1);
	}

	const preamble: string[] = [];
	const sections: { heading: string; body: string[] }[] = [];
	const inCode = insideCodeBlocks(lines);
	lines.forEach((line, i) => {
		if (!inCode[i] && HEADING.test(line)) sections.push({ heading: line, body: [] });
		else (sections.at(-1)?.body ?? preamble).push(line);
	});

	const seen = new Map<string, number>();
	return {
		frontmatter,
		preamble: preamble.join('\n').trim(),
		sections: sections.map(({ heading, body }) => {
			const n = (seen.get(heading) ?? 0) + 1;
			seen.set(heading, n);
			// A heading is a single line, so a newline cannot collide with real heading text.
			return { key: n === 1 ? heading : `${heading}\n${n}`, heading, body: body.join('\n').trim() };
		}),
	};
}

/** Lines before the first field (comments, blank lines) are kept under the empty name. */
function parseFrontmatter(lines: string[]): Map<string, string> {
	const fields = new Map<string, string>();
	let field = '';
	for (const line of lines) {
		field = FIELD.exec(line)?.[1]?.trim() ?? field;
		const previous = fields.get(field);
		fields.set(field, previous === undefined ? line : `${previous}\n${line}`);
	}
	return fields;
}

export function renderNote(note: Note): string {
	const parts: string[] = [];
	if (note.preamble) parts.push(note.preamble);
	for (const s of note.sections) parts.push(s.body ? `${s.heading}\n${s.body}` : s.heading);
	const body = parts.length ? `${parts.join('\n\n')}\n` : '';
	if (!note.frontmatter) return body;
	const fields = [...note.frontmatter.values()].map((lines) => `${lines}\n`).join('');
	const frontmatter = `---\n${fields}---\n`;
	return body ? `${frontmatter}\n${body}` : frontmatter;
}

export function codeBlocks(text: string): CodeBlock[] {
	const lines = text.split('\n');
	const blocks: CodeBlock[] = [];
	let open: { start: number; fence: string } | null = null;
	lines.forEach((line, i) => {
		const fence = FENCE.exec(line)?.[1];
		if (!fence) return;
		if (!open) {
			open = { start: i, fence };
		} else if (open.fence === fence) {
			blocks.push({ start: open.start, end: i, text: lines.slice(open.start, i + 1).join('\n').trim() });
			open = null;
		}
	});
	// Like Obsidian, an unclosed fence runs to the end of the note.
	const unclosed = open as { start: number } | null;
	if (unclosed) blocks.push({ start: unclosed.start, end: lines.length - 1, text: lines.slice(unclosed.start).join('\n').trim() });
	return blocks;
}

/** Remove these code blocks from the text, then collapse the blank lines left behind. */
export function removeCodeBlocks(text: string, blocks: CodeBlock[]): string {
	if (!blocks.length) return text;
	const lines = text.split('\n');
	for (const b of [...blocks].sort((x, y) => y.start - x.start)) lines.splice(b.start, b.end - b.start + 1);
	return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function insideCodeBlocks(lines: string[]): boolean[] {
	const inside = lines.map(() => false);
	for (const b of codeBlocks(lines.join('\n'))) inside.fill(true, b.start, b.end + 1);
	return inside;
}
