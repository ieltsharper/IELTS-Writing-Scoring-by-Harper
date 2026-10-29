import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers';

describe('guidance on assignments', () => {
  function create(app: ReturnType<typeof createTestApp>, admin: string, guidance?: string) {
    const now = app.svc.now();
    const config = app.call('config.get');
    const ielts7 = config.classes.find((c: any) => c.label === 'IELTS 7').id;
    const topicId = config.topics.find((t: any) => t.label === 'Education').id;
    return app.call(
      'admin.assignments.create',
      {
        title: 'Homework',
        taskType: 'task2',
        topicId,
        essayType: 'discussion',
        prompt: 'Some people think university should be free. Discuss both views.',
        ...(guidance === undefined ? {} : { guidance }),
        classIds: [ielts7],
        opensAt: now.toISOString(),
        closesAt: new Date(now.getTime() + 86400000).toISOString(),
      },
      admin,
    );
  }

  it('shows the teacher’s guidance with the question once the student starts', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    const student = app.login('demo.binh@example.com');
    const a = create(app, admin, 'Plan for 5 minutes.\nGive one example per body paragraph.');
    expect(app.call('admin.assignments.get', { id: a.id }, admin).guidance).toBe(
      'Plan for 5 minutes.\nGive one example per body paragraph.',
    );
    // Hidden in the list, like the prompt, until the test starts.
    const listed = app.call('assignments.mine', {}, student);
    expect(JSON.stringify(listed)).not.toContain('Plan for 5 minutes');
    const started = app.call('assignments.start', { id: a.id }, student);
    expect(started.guidance).toBe('Plan for 5 minutes.\nGive one example per body paragraph.');
    expect(app.call('essays.get', { id: started.id }, student).guidance).toContain('one example');
  });

  it('is optional', () => {
    const app = createTestApp();
    const admin = app.login('admin@example.com');
    const student = app.login('demo.binh@example.com');
    const a = create(app, admin);
    expect(app.call('assignments.start', { id: a.id }, student).guidance).toBe('');
  });
});
