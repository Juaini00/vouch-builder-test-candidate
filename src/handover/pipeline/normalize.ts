import { CanonicalEvent } from '../../common/types';

/** Merge structured + extracted into one canonical list, sorted by timestamp. */
export function normalize(
  structured: CanonicalEvent[],
  extracted: CanonicalEvent[],
): CanonicalEvent[] {
  const merged = [...structured, ...extracted];
  return merged.sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
}
