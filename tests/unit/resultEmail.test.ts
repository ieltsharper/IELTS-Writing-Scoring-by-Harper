import { describe, expect, it } from 'vitest';
import { markdownToEmailHtml, markdownToPlainText } from '../../shared/emailMarkdown';
import { resultEmail, type ResultEmailData } from '../../apps-script/src/emailTemplates';

describe('markdownToEmailHtml', () => {
  it('renders bold, italics, lists and links, and keeps Vietnamese', () => {
    const html = markdownToEmailHtml(
      '**Điểm mạnh**: bài có _bố cục_ rõ.\n\n- ý **một**\n- ý hai\n\n1. a\n2. b\n\n[xem](https://x.y/a_b_c)',
      { accent: '#b91c1c' },
    );
    expect(html).toContain('color:#b91c1c">Điểm mạnh:</strong>');
    expect(html).toContain('<em>bố cục</em>');
    expect(html).toContain('<ul');
    expect(html).toContain('<strong>một</strong>');
    expect(html).toContain('<ol');
    // An underscore inside a URL is not italics.
    expect(html).toContain('href="https://x.y/a_b_c"');
  });

  it('never lets input add markup or a script link', () => {
    const html = markdownToEmailHtml(
      '<script>alert(1)</script> <img src=x onerror=y>\n\n[bad](javascript:alert(1)) [ok](https://a.b/?q="x")\n\n`<b>`\uE000',
    );
    expect(html).not.toMatch(/<script|<img/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('"x"');
    expect(html).toContain('&lt;b&gt;</code>');
  });

  it('turns Markdown into plain text with line breaks kept', () => {
    expect(
      markdownToPlainText(
        '## Nhận xét\n- **Rất tốt!** Dùng từ _well-known_.\n> [Xem](https://x.y)',
      ),
    ).toBe('Nhận xét\n- Rất tốt! Dùng từ well-known.\nXem (https://x.y)');
  });
});

function data(over: Partial<ResultEmailData> = {}): ResultEmailData {
  const body = 'Many people thinks that it is good. Second sentence here.';
  return {
    to: 'a@example.com',
    name: 'An',
    taskTypeLabel: 'Task 2',
    topic: 'Technology',
    modeLabel: 'Practice',
    overall: 6.5,
    criteria: [
      { label: 'Task Response', score: 6 },
      { label: 'Coherence and Cohesion', score: 7 },
    ],
    generalComment: 'Bài tốt!',
    feedback: [
      { key: 'task', label: 'Task Response', text: '**Điểm tốt**: đủ ý.' },
      { key: 'grammar', label: 'Grammar', text: '' },
    ],
    body,
    errors: [
      {
        id: '1',
        category: 'Subject-verb agreement',
        criterion: 'grammar',
        excerpt: 'thinks',
        start: body.indexOf('thinks'),
        end: body.indexOf('thinks') + 6,
        correction: 'think',
        note: 'Chủ ngữ số nhiều.',
      },
    ],
    rewriteDue: null,
    url: 'https://example.test/#/essays/1',
    resent: false,
    sample: null,
    ...over,
  };
}

describe('result email', () => {
  it('holds the whole essay page: feedback, corrected essay and every error', () => {
    const m = resultEmail(data());
    expect(m.html).toContain('Điểm tốt:</strong>');
    expect(m.html).toContain('Bài tốt!');
    // Wrong words struck through, correction after them.
    expect(m.html).toContain('line-through');
    expect(m.html).toContain('> think</span>');
    expect(m.html).toContain('Many people');
    expect(m.html).toContain('Errors (1)');
    expect(m.html).toContain('Chủ ngữ số nhiều.');
    // A criterion without feedback gets no empty card.
    expect(m.html).not.toContain('>Grammar<');
    expect(m.html).toContain('href="https://example.test/#/essays/1"');
    expect(m.text).toContain('Many people [thinks -> think] that it is good.');
    expect(m.text).toContain('1. Subject-verb agreement: "thinks" -> think');
    expect(m.text).toContain('Điểm tốt: đủ ý.');
    expect(m.text).toContain('Open on the website: https://example.test/#/essays/1');
  });

  it('escapes the essay and the names', () => {
    const body = 'I <b>like</b> it & more.';
    const m = resultEmail(data({ body, errors: [], name: '<i>An</i>' }));
    expect(m.html).toContain('I &lt;b&gt;like&lt;/b&gt; it &amp; more.');
    expect(m.html).not.toContain('<i>An</i>');
  });

  it('drops the sample and error list when the message would be clipped by Gmail', () => {
    const long = 'Rất dài. '.repeat(12000);
    const m = resultEmail(
      data({
        generalComment: long,
        sample: { text: 'Sample text.', band: 8, analysis: [] },
      }),
    );
    expect(m.html).not.toContain('Sample text.');
    expect(m.html).not.toContain('Errors (');
    expect(m.html).toContain('too long to show everything');
    // Short emails keep everything.
    expect(
      resultEmail(data({ sample: { text: 'Sample text.', band: 8, analysis: [] } })).html,
    ).toContain('Sample text.');
  });
});
