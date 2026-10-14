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
