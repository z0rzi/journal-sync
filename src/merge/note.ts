import { mergeLines } from './lines';
import { codeBlocks, parseNote, renderNote, type ParsedNote, type Section } from './parse';

export interface NoteVersions {
	/** The common ancestor, or null when both devices created the note. */
	base: string | null;
	/** This device's version. */
	ours: string;
	/** The version already on GitHub. */
	theirs: string;
}

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

type Pick = 'ours' | 'theirs' | 'other';

/** Merge two versions of a Markdown note, never leaving conflict markers (ADR 0002). */
export function mergeNote(v: NoteVersions, ctx: MergeContext): NoteMergeResult {
	if (v.ours === v.theirs) return { text: v.theirs, stacked: false };
	const clean = mergeLines(v.base ?? '', v.ours, v.theirs);
	if (clean !== null) return { text: clean, stacked: false };

	const base = v.base === null ? null : parseNote(v.base);
	const ours = parseNote(v.ours);
	const theirs = parseNote(v.theirs);
	const template = ctx.template === null ? null : parseNote(ctx.template);

	const picks: Pick[] = [];
	let stacked = false;
	const pick = (p: Pick) => picks.push(p);

	const frontmatter = mergeFrontmatter(base?.frontmatter ?? null, ours.frontmatter, theirs.frontmatter, pick);

	const blank = (key: string | null, body: string): boolean => {
		if (body === '') return true;
		if (!template) return false;
		const t = key === null ? template.preamble : template.sections.find((s) => s.key === key)?.body;
		return t !== undefined && t === body;
	};

	const mergeBody = (key: string | null, b: string | undefined, o: string, t: string): string => {
		if (o === t) return t;
		if (blank(key, o)) return (pick('theirs'), t);
		if (blank(key, t)) return (pick('ours'), o);
		if (b !== undefined && o === b) return (pick('theirs'), t);
		if (b !== undefined && t === b) return (pick('ours'), o);
		pick('other');
		const merged = mergeLines(b ?? '', o, t);
		if (merged !== null) return merged;
		stacked = true;
		return stack(t, o, ctx);
	};

	const preamble = mergeBody(null, base?.preamble, ours.preamble, theirs.preamble);

	const baseSections = new Map(base?.sections.map((s) => [s.key, s]) ?? []);
	const oursSections = new Map(ours.sections.map((s) => [s.key, s]));
	const theirsSections = new Map(theirs.sections.map((s) => [s.key, s]));
	const sections: Section[] = [];
	for (const key of mergeOrder(
		theirs.sections.map((s) => s.key),
		ours.sections.map((s) => s.key),
	)) {
		const b = baseSections.get(key);
		const o = oursSections.get(key);
		const t = theirsSections.get(key);
		if (o && t) {
			sections.push({ ...t, body: mergeBody(key, b?.body, o.body, t.body) });
			continue;
		}
		// Present on one side only: added there, or deleted on the other side.
		// A deletion wins only over an unchanged section.
		const only = (o ?? t) as Section;
		const deletedOnOtherSide = b !== undefined && b.body === only.body;
		pick(deletedOnOtherSide === Boolean(o) ? 'theirs' : 'ours');
		if (!deletedOnOtherSide) sections.push(only);
	}

	if (picks.every((p) => p === 'theirs')) return { text: v.theirs, stacked: false };
	if (picks.every((p) => p === 'ours')) return { text: v.ours, stacked: false };

	const merged: ParsedNote = { frontmatter, preamble, sections };
	return { text: dedupeCodeBlocks(renderNote(merged), v.ours, v.theirs), stacked };
}

function stack(first: string, second: string, ctx: MergeContext): string {
	const known = new Set(codeBlocks(first).map((b) => b.text));
	const secondLines = second.split('\n');
	for (const block of codeBlocks(second).reverse()) {
		if (known.has(block.text)) secondLines.splice(block.start, block.end - block.start + 1);
	}
	const rest = secondLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
	return `*— ${ctx.theirsDevice} —*\n${first}\n\n*— ${ctx.oursDevice} —*\n${rest}`;
}

/** The GitHub order, with sections only this device has placed after the one they follow here. */
function mergeOrder(theirs: string[], ours: string[]): string[] {
	const order = [...theirs];
	let previous: string | null = null;
	for (const key of ours) {
		if (!order.includes(key)) order.splice(previous === null ? 0 : order.indexOf(previous) + 1, 0, key);
		previous = key;
	}
	return order;
}

function mergeFrontmatter(
	base: Map<string, string> | null,
	ours: Map<string, string> | null,
	theirs: Map<string, string> | null,
	pick: (p: Pick) => void,
): Map<string, string> | null {
	if (!ours && !theirs) return null;
	const o = ours ?? new Map<string, string>();
	const t = theirs ?? new Map<string, string>();
	const b = base ?? new Map<string, string>();
	const result = new Map<string, string>();
	for (const key of mergeOrder([...t.keys()], [...o.keys()])) {
		const ov = o.get(key);
		const tv = t.get(key);
		const bv = b.get(key);
		if (ov === tv) {
			if (ov !== undefined) result.set(key, ov);
			continue;
		}
		const oursChanged = ov !== bv;
		const theirsChanged = tv !== bv;
		let value: string | undefined;
		if (oursChanged && !theirsChanged) {
			pick('ours');
			value = ov;
		} else {
			pick(oursChanged ? 'other' : 'theirs');
			value = tv ?? ov;
		}
		if (value !== undefined) result.set(key, value);
	}
	return result;
}

/** Remove copies of fenced code blocks beyond what either side had. */
function dedupeCodeBlocks(text: string, ours: string, theirs: string): string {
	const allowed = new Map<string, number>();
	for (const source of [ours, theirs]) {
		const counts = new Map<string, number>();
		for (const b of codeBlocks(source)) counts.set(b.text, (counts.get(b.text) ?? 0) + 1);
		for (const [k, n] of counts) allowed.set(k, Math.max(allowed.get(k) ?? 0, n));
	}
	const seen = new Map<string, number>();
	const drop: { start: number; end: number }[] = [];
	for (const b of codeBlocks(text)) {
		const n = (seen.get(b.text) ?? 0) + 1;
		seen.set(b.text, n);
		if (n > (allowed.get(b.text) ?? 0)) drop.push(b);
	}
	if (!drop.length) return text;
	const lines = text.split('\n');
	for (const b of drop.reverse()) lines.splice(b.start, b.end - b.start + 1);
	return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
