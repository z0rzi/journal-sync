import { diff3Merge } from 'node-diff3';

/** The three versions of anything being merged. */
export interface Versions<T, Base = T> {
	/** The common ancestor. */
	base: Base;
	/** This device's version. */
	ours: T;
	/** The version already on GitHub. */
	theirs: T;
}

/**
 * Line-by-line three-way merge, like git's. Returns the merged text, or null
 * when both sides changed the same or adjacent lines.
 */
export function mergeLines({ base, ours, theirs }: Versions<string>): string | null {
	const regions = diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), {
		excludeFalseConflicts: true,
	});
	const merged: string[] = [];
	for (const region of regions) {
		if (region.conflict) return null;
		if (region.ok) merged.push(...region.ok);
	}
	return merged.join('\n');
}
