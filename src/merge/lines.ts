import { diff3Merge } from 'node-diff3';

/**
 * Line-by-line three-way merge, like git's. Returns the merged text, or null
 * when both sides changed the same or adjacent lines.
 */
export function mergeLines(base: string, ours: string, theirs: string): string | null {
	const regions = diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), {
		excludeFalseConflicts: true,
	});
	const out: string[] = [];
	for (const region of regions) {
		if (region.conflict) return null;
		if (region.ok) out.push(...region.ok);
	}
	return out.join('\n');
}
