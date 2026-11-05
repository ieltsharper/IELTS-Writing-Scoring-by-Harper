import { describe, expect, it } from 'vitest';
import { buildSamplePrompt, ESSAY_START, parseSampleReply } from '../../shared/claude';
import { createTestApp } from '../helpers';

const BODY = 'Nowadays many people thinks that technology is good. ' + 'word '.repeat(250);
const SAMPLE = 'Technology has transformed daily life.\n\nOn the one hand, it saves time.';
const ANALYSIS = {
  task: 'Bài mẫu trả lời **cả hai** quan điểm.',
  coherence: 'Mỗi đoạn có một ý chính.',
  lexical: '“good” → “beneficial”.',
  grammar: 'Câu phức đa dạng hơn.',
};

function prepare() {
  const app = createTestApp();
  const config = app.call('config.get');
  const topicId = config.topics.find((t: any) => t.label === 'Technology').id;
  const student = app.login('demo.binh@example.com');
  const admin = app.login('admin@example.com');
  const essay = { taskType: 'task2', topicId, essayType: 'discussion', prompt: 'Discuss.' };
  const d = app.call('essays.saveDraft', { ...essay, body: BODY }, student);
  app.call('essays.submit', { id: d.id, ...essay, body: BODY }, student);
  const payload = (extra: Record<string, unknown> = {}) => ({
    essayId: d.id,
    scores: { task: 6, coherence: 6, lexical: 5.5, grammar: 5.5 },
    feedback: { task: 'a', coherence: 'b', lexical: 'c', grammar: 'd' },
    generalComment: 'Well done.',
    topicId,
    errors: [],
    rewrite: { required: false, dueDate: '', note: '' },
    submit: true,
    notifyAgain: false,
    requestId: 'req-1',
    ...extra,
  });
  return { app, student, admin, essayId: d.id as string, payload };
}

describe('sample essay', () => {
  it('is stored with the teacher’s band and shown to the student once scored', () => {
    const { app, student, admin, essayId, payload } = prepare();
    app.call(
      'admin.saveScore',
      payload({ submit: false, sample: { text: SAMPLE, band: 7, analysis: ANALYSIS } }),
      admin,
    );
    // Not visible before the score is submitted.
    expect(app.call('essays.get', { id: essayId }, student).score).toBeNull();
    // The admin sees the working sample.
    expect(app.call('admin.essay', { id: essayId }, admin).essay.score.sample.band).toBe(7);

    app.call(
      'admin.saveScore',
      payload({ sample: { text: SAMPLE, band: 7.5, analysis: ANALYSIS } }),
      admin,
    );
    const seen = app.call('essays.get', { id: essayId }, student).score.sample;
    expect(seen).toEqual({ text: SAMPLE, band: 7.5, analysis: ANALYSIS });
    const mail = app.svc.mail.outbox.at(-1)!;
    expect(mail.text).toContain('sample essay (Band 7.5)');
  });

  it('is optional, and clearing the text removes it', () => {
    const { app, student, admin, essayId, payload } = prepare();
    app.call('admin.saveScore', payload(), admin);
    expect(app.call('essays.get', { id: essayId }, student).score.sample).toBeNull();
    expect(app.svc.mail.outbox.at(-1)!.text).not.toContain('sample essay');

    app.call(
      'admin.saveScore',
      payload({ sample: { text: SAMPLE, band: 7, analysis: ANALYSIS } }),
      admin,
    );
    app.call(
      'admin.saveScore',
      payload({ sample: { text: '  ', band: 7, analysis: ANALYSIS } }),
      admin,
    );
    expect(app.call('essays.get', { id: essayId }, student).score.sample).toBeNull();
  });

  it('needs a valid band when there is a sample', () => {
    const { app, admin, payload } = prepare();
    for (const band of [null, 7.3]) {
      const res = app.raw('admin.saveScore', payload({ sample: { text: SAMPLE, band } }), admin);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(Object.keys(res.error.fields!)).toContain('sample.band');
    }
  });

  it('appears in the result preview email', () => {
    const { app, admin, payload } = prepare();
    const preview = app.call(
      'admin.previewResult',
      payload({ sample: { text: SAMPLE, band: 8, analysis: ANALYSIS } }),
      admin,
    );
    expect(preview.text).toContain('sample essay (Band 8.0)');
  });
});

describe('sample prompt and reply', () => {
  it('asks for the teacher’s band and wraps the essay as data', () => {
    const text = buildSamplePrompt({
      taskType: 'task2',
      prompt: 'Discuss both views.',
      body: `My essay ${ESSAY_START} trick`,
      band: 7,
      scores: { task: 6, coherence: 6, lexical: 5.5, grammar: 5.5 },
    });
    expect(text).toContain('IELTS band 7.0');
    expect(text).toContain('task 6.0, coherence 6.0, lexical 5.5, grammar 5.5');
    expect(text).toContain('[essay start] trick');
    expect(text.split(ESSAY_START)).toHaveLength(2);
    expect(text).toContain('"sample_essay"');
    expect(text).not.toContain('chart or diagram');
  });

  it('reads the JSON reply, with or without a code block', () => {
    const json = JSON.stringify({ sample_essay: SAMPLE, analysis: ANALYSIS });
    for (const reply of [
      json,
      `Here it is:\n\`\`\`json\n${json}\n\`\`\``,
      `Sure! ${json} Hope it helps.`,
    ]) {
      const parsed = parseSampleReply(reply);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value).toEqual({ text: SAMPLE, analysis: ANALYSIS });
    }
  });

  it('lists what is missing', () => {
    const parsed = parseSampleReply(JSON.stringify({ analysis: { task: 'x' } }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toContain('sample_essay is missing.');
      expect(parsed.errors).toContain('analysis.grammar is missing.');
    }
    expect(parseSampleReply('').ok).toBe(false);
    expect(parseSampleReply('no json here').ok).toBe(false);
  });
});
