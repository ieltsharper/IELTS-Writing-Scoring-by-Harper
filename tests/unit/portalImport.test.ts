import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers';

const SECRET = 'portal-secret-'.padEnd(64, 'x');
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const BODY = 'Public transport should be cheaper for everyone. '.repeat(30);

function setup() {
  const app = createTestApp();
  app.svc.props.PORTAL_SECRET = SECRET;
  const admin = app.login('admin@example.com');
  const config = app.call('config.get');
  const topic = (label: string) => config.topics.find((t: any) => t.label === label).id;
  const base = (over: Record<string, unknown> = {}) => ({
    secret: SECRET,
    submissionId: 'sub-0000-0001',
    studentEmail: 'demo.binh@example.com',
    studentName: 'Tran Thi Binh',
    taskType: 'task2',
    topicId: topic('Transport'),
    essayType: 'discussion',
    prompt: 'Discuss whether public transport should be free.',
    body: BODY,
    mode: 'practice',
    ...over,
  });
  return { app, admin, base };
}

describe('essays imported from IELTS Harper Portal', () => {
  it('joins the normal queue and Drive archive for the matching student', () => {
    const { app, admin, base } = setup();
    const res = app.call('portal.essays.import', base());
    expect(res).toMatchObject({ duplicate: false, driveStatus: 'ok' });
    const essay = app.db().byId('Essays', res.essayId)!;
    const binh = app.db().findOne('Users', (u) => u.email === 'demo.binh@example.com')!;
    expect(essay).toMatchObject({
      student_id: binh.id,
      status: 'pending',
      mode: 'practice',
      source: 'portal:sub-0000-0001',
    });
    const item = app.call('admin.queue', {}, admin).items.find((i: any) => i.id === res.essayId);
    expect(item).toBeTruthy();
  });

  it('is idempotent: a retried request does not create a second essay', () => {
    const { app, base } = setup();
    const first = app.call('portal.essays.import', base());
    const again = app.call('portal.essays.import', base());
    expect(again).toEqual({ essayId: first.essayId, duplicate: true });
    expect(app.db().find('Essays', (e) => e.source === 'portal:sub-0000-0001')).toHaveLength(1);
  });

  it('refuses a wrong or missing secret, and works only when a long secret is set', () => {
    const { app, base } = setup();
    expect(app.raw('portal.essays.import', base({ secret: 'nope' }))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    app.svc.props.PORTAL_SECRET = 'short';
    expect(app.raw('portal.essays.import', base({ secret: 'short' }))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('times a test-mode essay from the portal start time', () => {
    const { app, base } = setup();
    const startedAt = new Date(app.svc.now().getTime() - 45 * 60000).toISOString();
    const res = app.call(
      'portal.essays.import',
      base({
        submissionId: 'sub-test-0001',
        mode: 'test',
        startedAt,
        autoSubmitted: true,
        pasteAttempts: 2,
      }),
    );
    const essay = app.db().byId('Essays', res.essayId)!;
    expect(essay).toMatchObject({
      mode: 'test',
      time_used_seconds: '2700',
      over_time: 'true',
      auto_submitted: 'true',
      paste_attempts: '2',
    });
  });

  it("times a retried test essay from the student's submit time, not its arrival", () => {
    const { app, base } = setup();
    const now = app.svc.now().getTime();
    const res = app.call(
      'portal.essays.import',
      base({
        submissionId: 'sub-late-0001',
        mode: 'test',
        startedAt: new Date(now - 3 * 3600000).toISOString(),
        submittedAt: new Date(now - 3 * 3600000 + 30 * 60000).toISOString(),
      }),
    );
    expect(app.db().byId('Essays', res.essayId)!).toMatchObject({
      time_used_seconds: '1800',
      over_time: 'false',
    });
  });

  it('creates a Harper student for a new email, and needs the image for Task 1', () => {
    const { app, base } = setup();
    const noImage = app.raw(
      'portal.essays.import',
      base({
        submissionId: 'sub-t1-0001',
        taskType: 'task1_academic',
        topicId: undefined,
        essayType: undefined,
        diagramType: 'dynamic',
      }),
    );
    expect(noImage).toMatchObject({ ok: false, error: { fields: { image: expect.any(String) } } });
    const res = app.call(
      'portal.essays.import',
      base({
        submissionId: 'sub-t1-0002',
        studentEmail: 'newcomer@example.com',
        studentName: 'Newcomer',
        taskType: 'task1_academic',
        topicId: undefined,
        essayType: undefined,
        diagramType: 'dynamic',
        image: { base64: PNG, mimeType: 'image/png', name: 'chart.png' },
      }),
    );
    const user = app.db().findOne('Users', (u) => u.email === 'newcomer@example.com')!;
    expect(user).toMatchObject({ role: 'student', name: 'Newcomer' });
    expect(app.db().byId('Essays', res.essayId)!.image_file_id).not.toBe('');
  });
});

describe('one-time login from IELTS Harper Portal', () => {
  const signin = (over: Record<string, unknown> = {}) => ({
    secret: SECRET,
    studentEmail: 'demo.binh@example.com',
    studentName: 'Tran Thi Binh',
    next: '/essays',
    ...over,
  });
  const tokenOf = (url: string) => decodeURIComponent(/token=([^&]+)/.exec(url)![1]);

  it('gives a link that logs the student in once and opens the page asked for', () => {
    const { app } = setup();
    const { url } = app.call('portal.signin', signin());
    expect(url).toMatch(/#\/auth\?token=[^&]+&next=%2Fessays$/);
    const res = app.call('auth.exchange', { token: tokenOf(url) });
    expect(res.user).toMatchObject({ email: 'demo.binh@example.com', role: 'student' });
    expect(app.raw('auth.exchange', { token: tokenOf(url) })).toMatchObject({ ok: false });
  });

  it('expires after 2 minutes', () => {
    const { app } = setup();
    const { url } = app.call('portal.signin', signin());
    app.svc.advance(3 * 60000);
    expect(app.raw('auth.exchange', { token: tokenOf(url) })).toMatchObject({ ok: false });
  });

  it('refuses a wrong secret, an admin email and a page outside Harper', () => {
    const { app } = setup();
    expect(app.raw('portal.signin', signin({ secret: 'x'.repeat(64) }))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(app.raw('portal.signin', signin({ studentEmail: 'admin@example.com' }))).toMatchObject({
      ok: false,
    });
    expect(app.raw('portal.signin', signin({ next: 'https://evil.example/' }))).toMatchObject({
      ok: false,
      error: { fields: { next: expect.any(String) } },
    });
  });

  it('creates the Harper account of a portal student who has none', () => {
    const { app } = setup();
    const { url } = app.call(
      'portal.signin',
      signin({ studentEmail: 'new.one@example.com', studentName: 'New One' }),
    );
    expect(app.call('auth.exchange', { token: tokenOf(url) }).user.email).toBe(
      'new.one@example.com',
    );
  });
});

describe('practice time from the portal', () => {
  it('keeps the time spent writing a practice essay', () => {
    const { app, base } = setup();
    const res = app.call(
      'portal.essays.import',
      base({ submissionId: 'sub-time-0001', timeSpentSeconds: 1500 }),
    );
    expect(app.db().byId('Essays', res.essayId)!).toMatchObject({
      mode: 'practice',
      time_used_seconds: '1500',
      over_time: 'false',
    });
  });
});

describe('AI pre-check from the portal', () => {
  const precheck = {
    firstDraft: `Public transport are cheap. ${BODY}`,
    firstAt: '2026-11-13T02:00:00.000Z',
    checks: 2,
    unavailable: null,
    errors: [
      {
        round: 1,
        criterion: 'GRA',
        type: 'Subject-verb agreement',
        excerpt: 'transport are',
        correction: 'transport is',
        hint: 'Is the subject singular or plural?',
        status: 'fixed',
        revealed: true,
      },
      {
        round: 2,
        criterion: 'LR',
        type: 'Collocation',
        excerpt: 'cheaper for everyone',
        correction: 'more affordable for everyone',
        hint: 'Think about a more formal word.',
        status: 'dismissed',
        revealed: false,
      },
      { excerpt: '' },
      'not an error',
    ],
    extra: 'ignored',
  };

  it('stores the first draft and errors and shows them to the teacher only', () => {
    const { app, admin, base } = setup();
    const res = app.call('portal.essays.import', base({ submissionId: 'sub-pre-0001', precheck }));
    const view = app.call('admin.essay', { id: res.essayId }, admin).essay.precheck;
    expect(view).toMatchObject({ checks: 2, unavailable: null, firstDraft: precheck.firstDraft });
    expect(view.errors).toHaveLength(2);
    expect(view.errors[0]).toMatchObject({ status: 'fixed', revealed: true, criterion: 'GRA' });
    expect(view.errors[1]).toMatchObject({ status: 'dismissed', criterion: 'LR' });
    expect(view.extra).toBeUndefined();
  });

  it('keeps an essay sent unchecked, ignores a bad pre-check and test essays', () => {
    const { app, admin, base } = setup();
    const essay = (over: Record<string, unknown>) => {
      const res = app.call('portal.essays.import', base(over));
      return app.call('admin.essay', { id: res.essayId }, admin).essay.precheck;
    };
    expect(
      essay({
        submissionId: 'sub-pre-0002',
        precheck: { firstDraft: BODY, checks: 0, unavailable: 'limit', errors: [] },
      }),
    ).toMatchObject({ checks: 0, unavailable: 'limit', errors: [] });
    expect(essay({ submissionId: 'sub-pre-0003', precheck: 'nonsense' })).toBeNull();
    expect(essay({ submissionId: 'sub-pre-0004' })).toBeNull();
  });

  it('fits in one sheet cell however long it is', async () => {
    const { precheckJson, readPrecheck, PRECHECK_MAX_CHARS } =
      await import('../../shared/precheck');
    const big = readPrecheck(
      {
        firstDraft: 'word '.repeat(4000),
        checks: 6,
        errors: Array.from({ length: 80 }, (_, i) => ({
          round: 1,
          criterion: 'LR',
          type: 'Word choice',
          excerpt: `excerpt ${i} `.repeat(15),
          correction: 'c'.repeat(300),
          hint: 'h'.repeat(400),
          status: 'open',
        })),
      },
      20000,
    )!;
    expect(big.errors).toHaveLength(60);
    const json = precheckJson(big);
    expect(json.length).toBeLessThanOrEqual(PRECHECK_MAX_CHARS);
    expect(JSON.parse(json).errors).toHaveLength(60);
  });
});
