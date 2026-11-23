/** A heading line with the text under it, up to the next heading of any level. */
export interface Section {
	/** Identity: the heading line, plus its occurrence number when repeated. */
	key: string;
	heading: string;
	/** Text under the heading, trimmed. */
	body: string;
}

export interface ParsedNote {
	/** Frontmatter fields in order, key -> raw lines (without the `---` fences). */
	frontmatter: Map<string, string> | null;
	/** Text above the first heading, frontmatter excluded, trimmed. */
	preamble: string;
	sections: Section[];
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^#{1,6}\s/;
const FIELD = /^([^\s#:-][^:]*):/;

export function parseNote(text: string): ParsedNote {
	let lines = text.replace(/\r\n/g, '\n').split('\n');
	let frontmatter: Map<string, string> | null = null;

	if (lines[0] === '---') {
		const end = lines.indexOf('---', 1);
		if (end > 0) {
			frontmatter = parseFrontmatter(lines.slice(1, end));
			lines = lines.slice(end + 1);
		}
	}

	const preamble: string[] = [];
	const sections: { heading: string; body: string[] }[] = [];
	let fence: string | null = null;
	for (const line of lines) {
		const fenceMatch = FENCE.exec(line);
		if (fenceMatch?.[1]) {
			if (fence === null) fence = fenceMatch[1];
			else if (fence === fenceMatch[1]) fence = null;
		}
		if (fence === null && !fenceMatch && HEADING.test(line)) {
			sections.push({ heading: line, body: [] });
		} else {
			(sections.at(-1)?.body ?? preamble).push(line);
		}
	}

	const seen = new Map<string, number>();
	return {
		frontmatter,
		preamble: preamble.join('\n').trim(),
		sections: sections.map(({ heading, body }) => {
			const n = (seen.get(heading) ?? 0) + 1;
			seen.set(heading, n);
			return { key: n === 1 ? heading : `${heading}\u0000${n}`, heading, body: body.join('\n').trim() };
		}),
	};
}

function parseFrontmatter(lines: string[]): Map<string, string> {
	const fields = new Map<string, string>();
	let current: string | null = null;
	let anonymous = 0;
	for (const line of lines) {
		const match = FIELD.exec(line);
		if (match?.[1]) {
			current = match[1].trim();
			fields.set(current, line);
		} else if (current !== null) {
			fields.set(current, `${fields.get(current)}\n${line}`);
		} else {
			fields.set(`\u0000${anonymous++}`, line);
		}
	}
	return fields;
}

export function renderNote(note: ParsedNote): string {
	const parts: string[] = [];
	if (note.preamble) parts.push(note.preamble);
	for (const s of note.sections) parts.push(s.body ? `${s.heading}\n${s.body}` : s.heading);
	const body = parts.length ? `${parts.join('\n\n')}\n` : '';
	if (!note.frontmatter) return body;
	const fm = `---\n${[...note.frontmatter.values()].join('\n')}${note.frontmatter.size ? '\n' : ''}---\n`;
	return body ? `${fm}\n${body}` : fm;
}

/** Fenced code blocks of a text, each as its exact lines joined. */
export function codeBlocks(text: string): { start: number; end: number; text: string }[] {
	const lines = text.split('\n');
	const blocks: { start: number; end: number; text: string }[] = [];
	let open: { start: number; fence: string } | null = null;
	lines.forEach((line, i) => {
		const m = FENCE.exec(line);
		if (!m?.[1]) return;
		if (!open) open = { start: i, fence: m[1] };
		else if (open.fence === m[1]) {
			blocks.push({ start: open.start, end: i, text: lines.slice(open.start, i + 1).join('\n').trim() });
			open = null;
		}
	});
	return blocks;
}
