import { describe, expect, it } from 'vitest';
import { findExcerptInContext, placeExcerpts } from '../../shared/excerpt';
import { inlineLayout } from '../../shared/inlineLayout';

const BODY =
  'Many companies invest in advertisement. The core of argument is that people buy more.';

function err(id: string, excerpt: string, correction: string, from = 0) {
  const start = BODY.indexOf(excerpt, from);
  return { id, start, end: start + excerpt.length, correction };
}

describe('inlineLayout', () => {
  it('strikes the wrong word and puts the correction after it', () => {
    const pieces = inlineLayout(BODY, [err('a', 'advertisement', 'advertising')]);
    expect(pieces).toEqual([
      { kind: 'text', text: 'Many companies invest in ' },
      {
        kind: 'error',
        id: 'a',
        ids: ['a'],
        original: 'advertisement',
        replacement: 'advertising',
        struck: true,
      },
      { kind: 'text', text: '. The core of argument is that people buy more.' },
    ]);
  });

  it('shows a deletion as struck-through text with no replacement', () => {
    const [, piece] = inlineLayout(BODY, [err('a', 'The core of ', '')]);
    expect(piece).toMatchObject({
      kind: 'error',
      original: 'The core of ',
      replacement: '',
      struck: true,
    });
  });

  it('only highlights when the correction equals the original', () => {
    const [, piece] = inlineLayout(BODY, [err('a', 'invest', 'invest')]);
    expect(piece).toMatchObject({ kind: 'error', struck: false, replacement: '' });
  });

  it('sorts errors by position and keeps all the text between them', () => {
    const pieces = inlineLayout(BODY, [
      err('b', 'argument', 'this argument'),
      err('a', 'invest', 'spend'),
    ]);
    const text = pieces.map((p) => (p.kind === 'text' ? p.text : p.original)).join('');
    expect(text).toBe(BODY);
    expect(pieces.filter((p) => p.kind === 'error').map((p) => (p as { id: string }).id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('folds an overlapping error into the earlier one and skips unplaced errors', () => {
    const pieces = inlineLayout(BODY, [
      err('a', 'The core of argument', 'The core of this argument'),
      err('b', 'core of', 'heart of'),
      { id: 'c', start: null, end: null, correction: 'x' },
    ]);
    const errors = pieces.filter((p) => p.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ id: 'a', ids: ['a', 'b'], struck: false, replacement: '' });
  });
});

describe('excerpt context', () => {
  const text = 'He said that it works. I think that people agree.';

  it('finds a repeated word at the place the context points to', () => {
    const span = findExcerptInContext(text, 'that', 'I think that people agree');
    expect(span).toEqual({ start: text.lastIndexOf('that'), end: text.lastIndexOf('that') + 4 });
  });

  it('falls back to the excerpt alone when the context is not in the essay', () => {
    const [span] = placeExcerpts(text, ['that'], ['made up words that are not here']);
    expect(span).toEqual({ start: text.indexOf('that'), end: text.indexOf('that') + 4 });
  });

  it('does not reuse an occurrence for the same context twice', () => {
    const spans = placeExcerpts(text, ['that', 'that'], ['think that people', 'think that people']);
    expect(spans[0]).toEqual(spans[1]);
  });
});
