import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers';

describe('admin.essays.delete', () => {
  it('lets only the admin delete an essay, and removes its score, errors and email log', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    const student = app.login('demo.an@example.com');
    const db = app.db();
    const scored = db.all('Essays').find((e) => e.status === 'scored' && !e.parent_essay_id)!;
    expect(scored).toBeTruthy();
    // Make sure the essay has no rewrite so it can be deleted.
    for (const child of db.find('Essays', (e) => e.parent_essay_id === scored.id)) {
      app.call('admin.essays.delete', { essayId: child.id }, admin);
    }

    expect(() => app.call('admin.essays.delete', { essayId: scored.id }, student)).toThrow(
      /forbidden/,
    );
    app.call('admin.essays.delete', { essayId: scored.id }, admin);

    const after = app.db();
    expect(after.byId('Essays', scored.id)).toBeUndefined();
    expect(after.find('Scores', (s) => s.essay_id === scored.id)).toEqual([]);
    expect(after.find('ErrorLog', (s) => s.essay_id === scored.id)).toEqual([]);
    expect(after.find('RewriteRequests', (s) => s.essay_id === scored.id)).toEqual([]);
    expect(() => app.call('admin.essay', { id: scored.id }, admin)).toThrow(/not found/i);
  });

  it('refuses to delete an essay that has a rewrite, and re-opens the request when the rewrite goes', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    const db = app.db();
    const parent = db.all('Essays').find((e) => e.status === 'scored' && !e.parent_essay_id)!;
    const rewrite = db.insert('Essays', {
      ...parent,
      id: 'rewrite-1',
      parent_essay_id: parent.id,
      drive_folder_id: '',
    });
    db.insert('RewriteRequests', {
      id: 'rr-1',
      essay_id: parent.id,
      due_at: '2099-01-01T00:00:00.000Z',
      note: '',
      status: 'submitted',
      rewrite_essay_id: rewrite.id,
      created_at: '2026-01-01T00:00:00.000Z',
    });

    expect(() => app.call('admin.essays.delete', { essayId: parent.id }, admin)).toThrow(
      /rewrite/i,
    );
    app.call('admin.essays.delete', { essayId: rewrite.id }, admin);

    const rr = app.db().byId('RewriteRequests', 'rr-1')!;
    expect(rr.status).toBe('requested');
    expect(rr.rewrite_essay_id).toBe('');
    expect(app.db().byId('Essays', parent.id)).toBeTruthy();
  });
});
