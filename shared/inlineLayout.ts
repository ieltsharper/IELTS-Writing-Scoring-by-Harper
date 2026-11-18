// Layout for the student's corrected essay: each tagged error becomes one piece in which
// the wrong words are struck through and the correction follows. Pure, so it is unit tested.

export interface LayoutError {
  id: string;
  start: number | null;
  end: number | null;
  correction: string;
}

export type InlinePiece =
  | { kind: 'text'; text: string }
  | {
      kind: 'error';
      /** The error shown in the text (the first of a group of overlapping errors). */
      id: string;
      /** All error ids covered by this piece, the first one included. */
      ids: string[];
      /** The original, wrong words. */
      original: string;
      /** The replacement shown after the struck-through words; '' when the words are only deleted. */
      replacement: string;
      /** True when the original is crossed out (the correction differs from it). */
      struck: boolean;
    };

/**
 * Split the essay into plain text and error pieces. Errors that overlap an earlier error are
 * folded into it (their ids are kept in `ids`), so the text never shows two corrections for
 * the same words. Errors that were not placed in the text are left out.
 */
export function inlineLayout(body: string, errors: LayoutError[]): InlinePiece[] {
  const placed = errors
    .filter(
      (e) =>
        e.start !== null &&
        e.end !== null &&
        e.start >= 0 &&
        e.end <= body.length &&
        e.end > e.start,
    )
    .map((e) => ({ id: e.id, start: e.start!, end: e.end!, correction: e.correction }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const groups: Array<{ start: number; end: number; correction: string; ids: string[] }> = [];
  for (const e of placed) {
    const last = groups[groups.length - 1];
    if (last && e.start < last.end) {
      last.ids.push(e.id);
      last.end = Math.max(last.end, e.end);
    } else {
      groups.push({ start: e.start, end: e.end, correction: e.correction, ids: [e.id] });
    }
  }

  const pieces: InlinePiece[] = [];
  let pos = 0;
  for (const g of groups) {
    if (g.start > pos) pieces.push({ kind: 'text', text: body.slice(pos, g.start) });
    const original = body.slice(g.start, g.end);
    // A group of overlapping errors spans more than the first error's words, so its
    // correction no longer fits it: show the words highlighted without striking them.
    const merged = g.ids.length > 1;
    const replacement = merged ? '' : g.correction.trim();
    const struck = !merged && replacement !== original.trim();
    pieces.push({
      kind: 'error',
      id: g.ids[0],
      ids: g.ids,
      original,
      replacement: struck ? replacement : '',
      struck,
    });
    pos = g.end;
  }
  if (pos < body.length) pieces.push({ kind: 'text', text: body.slice(pos) });
  return pieces;
}
