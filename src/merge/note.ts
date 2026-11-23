import { mergeLines, type Versions } from './lines';
import { codeBlocks, parseNote, removeCodeBlocks, renderNote, type Note, type Section } from './parse';

/** A note's three versions; `base` is null when both devices created the note. */
export type NoteVersions = Versions<string, string | null>;

export interface MergeContext {
	/** Raw template the note was created from, if any. */
	template: string | null;
	oursDevice: string;
	theirsDevice: string;
}

export interface NoteMergeResult {
	text: string;
	/** True when at least one Section had to be Stacked. */
	stacked: boolean;
}

/** Merge two versions of a Markdown note without ever writing conflict markers (ADR 0002). */
export function mergeNote(v: NoteVersions, ctx: MergeContext): NoteMergeResult {
	if (v.ours === v.theirs) return { text: v.theirs, stacked: false };
	const clean = mergeLines({ base: v.base ?? '', ours: v.ours, theirs: v.theirs });
	if (clean !== null) return { text: withoutExtraCodeBlocks(clean, v), stacked: false };

	const merger = new SectionMerger(ctx);
	const note = merger.merge({
		base: v.base === null ? null : parseNote(v.base),
		ours: parseNote(v.ours),
		theirs: parseNote(v.theirs),
	});
	const text = renderNote(note);
	// Prefer a side's exact text when the merge changed nothing of it.
	if (text === renderNote(parseNote(v.theirs))) return { text: v.theirs, stacked: false };
	if (text === renderNote(parseNote(v.ours))) return { text: v.ours, stacked: false };
	return { text: withoutExtraCodeBlocks(text, v), stacked: merger.stacked };
}

/** The Device marker above each version of a Stacked Section. */
function deviceMarker(device: string): string {
	return `*— ${device} —*`;
}

class SectionMerger {
	stacked = false;
	private template: Note | null;

	constructor(private readonly ctx: MergeContext) {
		this.template = ctx.template === null ? null : parseNote(ctx.template);
	}

	merge(v: Versions<Note, Note | null>): Note {
		const sections: Section[] = [];
		const base = byKey(v.base?.sections ?? []);
		const ours = byKey(v.ours.sections);
		const theirs = byKey(v.theirs.sections);
		for (const key of mergeOrder([...theirs.keys()], [...ours.keys()])) {
			const body = this.mergeBody(key, { base: base.get(key)?.body, ours: ours.get(key)?.body, theirs: theirs.get(key)?.body });
			const heading = (theirs.get(key) ?? ours.get(key))?.heading;
			if (body !== undefined && heading !== undefined) sections.push({ key, heading, body });
		}
		return {
			frontmatter: mergeFrontmatter(v.base?.frontmatter ?? null, v.ours.frontmatter, v.theirs.frontmatter),
			preamble: this.mergeBody(null, { base: v.base?.preamble, ours: v.ours.preamble, theirs: v.theirs.preamble }) ?? '',
			sections,
		};
	}

	/**
	 * One Section's text (null key: the Preamble), following the spec's rules in
	 * order. Undefined means the Section is absent from the result.
	 */
	private mergeBody(key: string | null, { base, ours, theirs }: Versions<string | undefined>): string | undefined {
		if (ours === theirs) return theirs;
		if (ours === undefined || theirs === undefined) {
			// On one side only. Deleted on the other: the deletion wins only over an
			// unchanged Section. Added: kept, unless it is just the template's text,
			// which the other side has removed.
			const kept = (ours ?? theirs) as string;
			if (base === undefined) return this.isTemplateText(key, kept) ? undefined : kept;
			return kept === base ? undefined : kept;
		}
		if (this.isBlank(key, ours)) return theirs;
		if (this.isBlank(key, theirs)) return ours;
		if (ours === base) return theirs;
		if (theirs === base) return ours;
		const merged = mergeLines({ base: base ?? '', ours, theirs });
		if (merged !== null) return merged;
		this.stacked = true;
		return this.stack(theirs, ours);
	}

	/** Empty, or still exactly the template's text. */
	private isBlank(key: string | null, body: string): boolean {
		return body === '' || this.isTemplateText(key, body);
	}

	/** The template has this Section with exactly this text. Templater code can't be matched, so it never does. */
	private isTemplateText(key: string | null, body: string): boolean {
		const template = key === null ? this.template?.preamble : this.template?.sections.find((s) => s.key === key)?.body;
		return template !== undefined && !template.includes('<%') && template === body;
	}

	private stack(theirs: string, ours: string): string {
		const known = new Set(codeBlocks(theirs).map((b) => b.text));
		const repeated = codeBlocks(ours).filter((b) => known.has(b.text));
		const oursRest = removeCodeBlocks(ours, repeated).trim();
		return `${deviceMarker(this.ctx.theirsDevice)}\n${theirs}\n\n${deviceMarker(this.ctx.oursDevice)}\n${oursRest}`;
	}
}

function byKey(sections: Section[]): Map<string, Section> {
	return new Map(sections.map((s) => [s.key, s]));
}

/** The GitHub order, with keys only this device has placed after the one they follow here. */
function mergeOrder(theirs: string[], ours: string[]): string[] {
	const order = [...theirs];
	let previous: string | null = null;
	for (const key of ours) {
		if (!order.includes(key)) order.splice(previous === null ? 0 : order.indexOf(previous) + 1, 0, key);
		previous = key;
	}
	return order;
}

/** Field by field: the side that changed a field wins; when both did, the GitHub side wins. */
function mergeFrontmatter(
	base: Map<string, string> | null,
	ours: Map<string, string> | null,
	theirs: Map<string, string> | null,
): Map<string, string> | null {
	if (!ours && !theirs) return null;
	const result = new Map<string, string>();
	for (const field of mergeOrder([...(theirs?.keys() ?? [])], [...(ours?.keys() ?? [])])) {
		const b = base?.get(field);
		const o = ours?.get(field);
		const t = theirs?.get(field);
		const value = t === b ? o : t;
		if (value !== undefined) result.set(field, value);
	}
	return result;
}

/** A merge never leaves more copies of a code block than either side had (ADR 0002). */
function withoutExtraCodeBlocks(text: string, v: NoteVersions): string {
	const allowed = new Map<string, number>();
	for (const side of [v.ours, v.theirs]) {
		for (const [block, n] of countBlocks(side)) allowed.set(block, Math.max(allowed.get(block) ?? 0, n));
	}
	const seen = new Map<string, number>();
	const extra = codeBlocks(text).filter((b) => {
		const n = (seen.get(b.text) ?? 0) + 1;
		seen.set(b.text, n);
		return n > (allowed.get(b.text) ?? 0);
	});
	return removeCodeBlocks(text, extra);
}

function countBlocks(text: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const b of codeBlocks(text)) counts.set(b.text, (counts.get(b.text) ?? 0) + 1);
	return counts;
}
