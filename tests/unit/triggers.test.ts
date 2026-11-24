import { describe, expect, it } from 'vitest';
import { runDailyJob, runHourlyJob } from '../../apps-script/src/triggers';
import { createTestApp } from '../helpers';

describe('daily job: rewrite reminders and overdue status', () => {
  it('sends one reminder 2 days before, then one overdue email, each at most once', () => {
    const app = createTestApp();
    // Demo rewrite request for An is due in 5 days.
    const rr = app.db().all('RewriteRequests')[0];
    expect(runDailyJob(app.svc).reminders).toBe(0);

    // Due at the end of 15 Oct in Asia/Ho_Chi_Minh (5.6 days away); move to ~1.6 days before.
    app.svc.advance(4 * 86400000);
    expect(runDailyJob(app.svc).reminders).toBe(1);
    expect(runDailyJob(app.svc).reminders).toBe(0); // at most once
    const reminder = app.svc.mail.outbox.filter((m) => m.subject.startsWith('Reminder'));
    expect(reminder).toHaveLength(1);
    expect(reminder[0].bcc).toEqual(['demo.an@example.com']);

    app.svc.advance(2 * 86400000); // past the due date
    expect(runDailyJob(app.svc).overdue).toBe(1);
    runDailyJob(app.svc);
    expect(app.db().byId('RewriteRequests', rr.id)!.status).toBe('overdue');
    expect(app.svc.mail.outbox.filter((m) => m.subject.includes('overdue'))).toHaveLength(1);
    const events = app.db().find('EmailEvents', (e) => e.idempotency_key.includes(rr.id));
    expect(events.map((e) => e.type).sort()).toEqual(['rewrite_overdue', 'rewrite_reminder']);

    // A missed deadline shows as overdue on the student dashboard.
    const student = app.login('demo.an@example.com');
    expect(app.call('dashboard.get', {}, student).rewrites[0].status).toBe('overdue');
    // Late rewrites are still accepted.
    const d = app.call(
      'essays.saveDraft',
      { parentEssayId: rr.essay_id, body: 'A late rewrite of my essay.' },
      student,
    );
    app.call('essays.submit', { id: d.id, body: 'A late rewrite of my essay.' }, student);
    expect(app.db().byId('RewriteRequests', rr.id)!.status).toBe('submitted');
  });
});

describe('reminder emails in batches', () => {
  /** Give `count` extra students a scored essay with a rewrite request due in 5 days. */
  function addRewrites(app: ReturnType<typeof createTestApp>, count: number) {
    const db = app.db();
    const rr = db.all('RewriteRequests')[0];
    const essay = db.byId('Essays', rr.essay_id)!;
    const student = db.byId('Users', essay.student_id)!;
    for (let i = 0; i < count; i++) {
      const id = app.svc.uuid();
      db.insert('Users', { ...student, id, email: `extra${i}@example.com`, name: `Extra ${i}` });
      const essayId = app.svc.uuid();
      db.insert('Essays', { ...essay, id: essayId, student_id: id });
      db.insert('RewriteRequests', { ...rr, id: app.svc.uuid(), essay_id: essayId });
    }
  }

  it('sends one BCC message to every student who needs a reminder', () => {
    const app = createTestApp();
    addRewrites(app, 2);
    app.svc.advance(4 * 86400000);
    expect(runDailyJob(app.svc).reminders).toBe(3);

    expect(app.svc.mail.outbox).toHaveLength(1);
    const mail = app.svc.mail.outbox[0];
    expect(mail.to).toBe(''); // sent to the teacher's own address by Gmail
    expect(mail.bcc!.sort()).toEqual([
      'demo.an@example.com',
      'extra0@example.com',
      'extra1@example.com',
    ]);
    // No student's address or name appears in the visible message.
    expect(mail.text + mail.html).not.toMatch(/extra0|demo\.an|Extra 0/);
    // Each student still has their own record, so nobody is reminded twice.
    expect(app.db().find('EmailEvents', (e) => e.type === 'rewrite_reminder')).toHaveLength(3);
    expect(runDailyJob(app.svc).reminders).toBe(0);
    expect(app.svc.mail.outbox).toHaveLength(1);
  });

  it('splits a large group into messages of at most 50 students', () => {
    const app = createTestApp();
    addRewrites(app, 59); // 60 students in total
    app.svc.mail.quota = 1000;
    app.svc.advance(4 * 86400000);
    runDailyJob(app.svc);
    expect(app.svc.mail.outbox.map((m) => m.bcc!.length)).toEqual([50, 10]);
  });

  it('counts every recipient against the quota and queues what does not fit', () => {
    const app = createTestApp();
    addRewrites(app, 4); // 5 students
    app.svc.mail.quota = 10 + 1 + 3; // reserve 10, the To copy, 3 students
    app.svc.advance(4 * 86400000);
    runDailyJob(app.svc);
    expect(app.svc.mail.outbox).toHaveLength(1);
    expect(app.svc.mail.outbox[0].bcc).toHaveLength(3);
    expect(app.db().find('EmailEvents', (e) => e.status === 'queued')).toHaveLength(2);

    // When quota returns, the hourly job sends the rest as one more batch.
    app.svc.mail.quota = 100;
    expect(runHourlyJob(app.svc)).toMatchObject({ emailsSent: 2, emailsQueued: 0 });
    expect(app.svc.mail.outbox).toHaveLength(2);
    expect(app.svc.mail.outbox[1].bcc).toHaveLength(2);
    const sentTo = app.svc.mail.outbox.flatMap((m) => m.bcc!);
    expect(new Set(sentTo).size).toBe(5);
  });
});

describe('hourly job', () => {
  it('sends queued emails when quota returns, login links first', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    app.svc.mail.quota = 0;
    app.call('auth.requestLink', { email: 'demo.binh@example.com' }); // queued login link
    const pending = app.call('admin.queue', {}, admin).items[0];
    const topicId = app.db().byId('Essays', pending.id)!.topic_id;
    app.call(
      'admin.saveScore',
      {
        essayId: pending.id,
        scores: { task: 6, coherence: 6, lexical: 6, grammar: 6 },
        topicId,
        errors: [],
        submit: true,
      },
      admin,
    );
    expect(app.db().find('EmailEvents', (e) => e.status === 'queued')).toHaveLength(2);

    app.svc.mail.quota = 11; // one login link fits; results must leave a reserve of 10
    let res = runHourlyJob(app.svc);
    expect(res).toMatchObject({ emailsSent: 1, emailsQueued: 1 });
    expect(app.svc.mail.outbox.at(-1)!.subject).toContain('login link');
    // The queued login link was generated fresh and works.
    const token = /token=([a-f0-9]+)/.exec(app.svc.mail.outbox.at(-1)!.text)![1];
    expect(app.call('auth.exchange', { token }).user.email).toBe('demo.binh@example.com');

    app.svc.mail.quota = 100;
    res = runHourlyJob(app.svc);
    expect(res).toMatchObject({ emailsSent: 1, emailsQueued: 0 });
    expect(app.svc.mail.outbox.at(-1)!.subject).toContain('Your score');
  });

  it('auto-submits abandoned timed tests without marking them over time', () => {
    const app = createTestApp();
    const student = app.login('demo.binh@example.com');
    const topicId = app.call('config.get').topics[0].id;
    const t = app.call(
      'essays.startTest',
      { taskType: 'task2', topicId, essayType: 'discussion', prompt: 'Discuss the question.' },
      student,
    );
    app.call('essays.saveDraft', { id: t.id, body: 'Some words written before leaving.' }, student);
    app.svc.advance(90 * 60000);
    expect(runHourlyJob(app.svc).autoSubmitted).toBe(1);
    const essay = app.db().byId('Essays', t.id)!;
    expect(essay.status).toBe('pending');
    expect(essay.auto_submitted).toBe('true');
    expect(essay.over_time).toBe('false');
    expect(essay.time_used_seconds).toBe(String(40 * 60));
  });
});

describe('assigned tests', () => {
  it('hides the prompt until start, allows one attempt and marks missed after close', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    const an = app.login('demo.an@example.com');
    const binh = app.login('demo.binh@example.com');
    const classes = app.call('config.get').classes;
    const ielts5 = classes.find((c: any) => c.label === 'IELTS 5').id;
    const topicId = app.call('config.get').topics[0].id;
    const now = app.svc.now();
    const created = app.call(
      'admin.assignments.create',
      {
        title: 'Week 3 test',
        taskType: 'task2',
        topicId,
        essayType: 'discussion',
        prompt: 'Secret prompt about education.',
        classIds: [ielts5],
        studentIds: [],
        opensAt: now.toISOString(),
        closesAt: new Date(now.getTime() + 86400000).toISOString(),
        emailStudents: true,
      },
      admin,
    );
    expect(created.emails).toEqual({ sent: 1 }); // An only (IELTS 5)

    const mine = app.call('assignments.mine', {}, an);
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain('Secret prompt');
    expect(app.call('assignments.mine', {}, binh)).toHaveLength(0);
    expect(app.raw('assignments.start', { id: created.id }, binh)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });

    const essay = app.call('assignments.start', { id: created.id }, an);
    expect(essay.prompt).toBe('Secret prompt about education.');
    expect(essay.mode).toBe('assigned');
    expect(app.call('assignments.start', { id: created.id }, an).id).toBe(essay.id); // resumes, timer keeps running
    app.call('essays.submit', { id: essay.id, body: 'My answer to the secret prompt.' }, an);
    expect(app.raw('assignments.start', { id: created.id }, an).ok).toBe(false);

    const detail = app.call('admin.assignments.get', { id: created.id }, admin);
    expect(detail.students.map((s: any) => s.status)).toEqual(['submitted']);
    const queue = app.call('admin.queue', { assignmentId: created.id }, admin);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].assignmentTitle).toBe('Week 3 test');

    // A second assignment nobody starts becomes "missed" after it closes.
    const second = app.call(
      'admin.assignments.create',
      {
        title: 'Week 4 test',
        taskType: 'task2',
        topicId,
        essayType: 'discussion',
        prompt: 'Another prompt here.',
        classIds: [ielts5],
        opensAt: now.toISOString(),
        closesAt: new Date(now.getTime() + 3600000).toISOString(),
      },
      admin,
    );
    app.svc.advance(2 * 3600000);
    expect(app.call('admin.assignments.get', { id: second.id }, admin).students[0].status).toBe(
      'missed',
    );
    expect(app.raw('assignments.start', { id: second.id }, an)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
  });
});
