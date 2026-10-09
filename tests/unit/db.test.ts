import { describe, expect, it } from 'vitest';
import { Db, fromCell, toCell } from '../../apps-script/src/db';
import { runSetup } from '../../apps-script/src/setup';
import { createMemoryServices } from '../../apps-script/testing/memory';

describe('formula-safe cells', () => {
  it('prefixes values Sheets would run as formulas', () => {
    expect(toCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(toCell('+1')).toBe("'+1");
    expect(toCell('-cmd')).toBe("'-cmd");
    expect(toCell('@me')).toBe("'@me");
    expect(toCell('Normal text')).toBe('Normal text');
    expect(toCell(6.5)).toBe('6.5');
    expect(toCell(null)).toBe('');
  });

  it('reads values back unchanged', () => {
    expect(fromCell("'=1+1")).toBe('=1+1');
    expect(fromCell("'quoted")).toBe("'quoted");
    expect(fromCell(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
  });

  it('stores an essay starting with "=" as text, not a formula', () => {
    const svc = createMemoryServices();
    runSetup(svc, { demo: false });
    const db = new Db(svc.spreadsheet);
    db.insert('Drafts', { id: 'd1', essay_id: 'e1', kind: 'initial', raw_text: '=IMPORTXML("x")' });
    expect(svc.spreadsheet.formulaCount()).toBe(0);
    const fresh = new Db(svc.spreadsheet);
    expect(fresh.byId('Drafts', 'd1')?.raw_text).toBe('=IMPORTXML("x")');
    fresh.update('Drafts', (r) => r.id === 'd1', { raw_text: '@SUM(1)' });
    expect(svc.spreadsheet.formulaCount()).toBe(0);
    expect(new Db(svc.spreadsheet).byId('Drafts', 'd1')?.raw_text).toBe('@SUM(1)');
  });

  it('updates and removes rows', () => {
    const svc = createMemoryServices();
    runSetup(svc, { demo: false });
    const db = new Db(svc.spreadsheet);
    db.insert('Topics', { id: 'a', label: 'A', active: true });
    db.insert('Topics', { id: 'b', label: 'B', active: true });
    expect(db.update('Topics', (r) => r.id === 'a', { label: 'A2' })).toBe(1);
    expect(db.remove('Topics', (r) => r.id === 'b')).toBe(1);
    const fresh = new Db(svc.spreadsheet);
    expect(fresh.byId('Topics', 'a')?.label).toBe('A2');
    expect(fresh.byId('Topics', 'b')).toBeUndefined();
  });
});
