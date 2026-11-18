// Map an error excerpt to character offsets in the essay.

export interface Span {
  start: number;
  end: number;
}

/**
 * Find the excerpt in the essay. Exact matches only (after trimming the
 * excerpt's outer whitespace). When the excerpt occurs several times, the
 * first occurrence not already used by an identical error is chosen.
 * Returns null when the excerpt cannot be placed.
 */
export function findExcerpt(body: string, excerpt: string, taken: Span[] = []): Span | null {
  const needle = excerpt.trim();
  if (!needle) return null;
  let first: Span | null = null;
  let from = 0;
  for (;;) {
    const idx = body.indexOf(needle, from);
    if (idx === -1) break;
    const span = { start: idx, end: idx + needle.length };
    first ??= span;
    if (!taken.some((t) => t.start === span.start && t.end === span.end)) return span;
    from = idx + 1;
  }
  return first;
}

/**
 * Find a short excerpt (often a single word) by way of a longer quote around it. The context is
 * located in the essay first and the excerpt inside it, so a word that occurs several times is
 * found at the right place. Returns null when the context or the excerpt is not found.
 */
export function findExcerptInContext(
  body: string,
  excerpt: string,
  context: string,
  taken: Span[] = [],
): Span | null {
  const needle = excerpt.trim();
  const quote = context.trim();
  if (!needle || !quote) return null;
  const inner = quote.indexOf(needle);
  if (inner === -1) return null;
  let first: Span | null = null;
  let from = 0;
  for (;;) {
    const idx = body.indexOf(quote, from);
    if (idx === -1) break;
    const span = { start: idx + inner, end: idx + inner + needle.length };
    first ??= span;
    if (!taken.some((t) => t.start === span.start && t.end === span.end)) return span;
    from = idx + 1;
  }
  return first;
}

/**
 * Place several excerpts in order, avoiding reuse of the same occurrence. A context quote, when
 * given and found, decides which occurrence of the excerpt is meant.
 */
export function placeExcerpts(
  body: string,
  excerpts: string[],
  contexts: Array<string | undefined> = [],
): Array<Span | null> {
  const taken: Span[] = [];
  return excerpts.map((x, i) => {
    const context = contexts[i];
    const span =
      (context ? findExcerptInContext(body, x, context, taken) : null) ??
      findExcerpt(body, x, taken);
    if (span) taken.push(span);
    return span;
  });
}
