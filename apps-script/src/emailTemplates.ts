// Email content: table-based HTML that renders in Gmail and Outlook, plus a
// plain-text version. All dynamic text goes through escapeHtml.
import { formatBand } from '../../shared/band';
import { CRITERIA, CRITERION_SHORT, type Criterion } from '../../shared/constants';
import { markdownToEmailHtml, markdownToPlainText } from '../../shared/emailMarkdown';
import { escapeHtml as e } from '../../shared/escape';
import { inlineLayout } from '../../shared/inlineLayout';
import type { MailMessage } from './services';

interface Layout {
  to: string;
  subject: string;
  preheader: string;
  heading: string;
  /** Pre-escaped HTML blocks. */
  blocks: string[];
  button?: { label: string; url: string };
  text: string[];
}

function layout(l: Layout): MailMessage {
  const button = l.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr>
<td bgcolor="#c2410c" style="border-radius:6px">
<a href="${e(l.button.url)}" style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#ffffff;text-decoration:none;font-weight:bold">${e(l.button.label)}</a>
</td></tr></table>`
    : '';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(l.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6"><tr><td align="center" style="padding:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px" bgcolor="#ffffff">
<tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111827">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827">${e(l.heading)}</h1>
${l.blocks.join('\n')}
${button}
<p style="margin:24px 0 0;font-size:13px;color:#4b5563">IELTS Harper · This email was sent by your teacher's account.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [...l.text, ...(l.button ? ['', `${l.button.label}: ${l.button.url}`] : [])].join(
    '\n',
  );
  return { to: l.to, subject: l.subject, html, text };
}

const p = (text: string) => `<p style="margin:0 0 12px">${e(text)}</p>`;

export function loginEmail(to: string, name: string, url: string): MailMessage {
  return layout({
    to,
    subject: 'Your login link for IELTS Harper',
    preheader: 'This link works once and expires in 15 minutes.',
    heading: `Hi ${name}`,
    blocks: [
      p('Use the button below to log in. The link works once and expires in 15 minutes.'),
      p('If you did not ask for this email, you can ignore it.'),
    ],
    button: { label: 'Log in', url },
    text: [
      `Hi ${name},`,
      '',
      'Use this link to log in. It works once and expires in 15 minutes.',
      'If you did not ask for this email, you can ignore it.',
    ],
  });
}

export function passwordResetEmail(to: string, name: string, url: string): MailMessage {
  return layout({
    to,
    subject: 'Reset your IELTS Harper password',
    preheader: 'This link works once and expires in 30 minutes.',
    heading: `Hi ${name}`,
    blocks: [
      p(
        'We received a request to reset your password. Use the button below to choose a new one. The link works once and expires in 30 minutes.',
      ),
      p('If you did not ask for this, you can ignore this email: your password has not changed.'),
    ],
    button: { label: 'Choose a new password', url },
    text: [
      `Hi ${name},`,
      '',
      'We received a request to reset your password. Use this link to choose a new one. It works once and expires in 30 minutes.',
      'If you did not ask for this, you can ignore this email: your password has not changed.',
    ],
  });
}

/** Colours per criterion, matching the website (essay highlights and feedback cards). */
const CRIT_COLOURS: Record<
  Criterion,
  { accent: string; soft: string; mark: string; line: string }
> = {
  task: { accent: '#b91c1c', soft: '#fef2f2', mark: '#fecaca', line: '#dc2626' },
  coherence: { accent: '#c2410c', soft: '#fff7ed', mark: '#fed7aa', line: '#ea580c' },
  lexical: { accent: '#1d4ed8', soft: '#eff6ff', mark: '#bfdbfe', line: '#2563eb' },
  grammar: { accent: '#7e22ce', soft: '#faf5ff', mark: '#e9d5ff', line: '#9333ea' },
};
const NEUTRAL = { accent: '#374151', soft: '#f3f4f6', mark: '#e5e7eb', line: '#9ca3af' };

export interface EmailCriterionText {
  key: Criterion;
  label: string;
  /** Markdown. */
  text: string;
}

export interface EmailError {
  id: string;
  category: string;
  criterion: Criterion | null;
  excerpt: string;
  start: number | null;
  end: number | null;
  correction: string;
  note: string;
}

export interface ResultEmailData {
  to: string;
  name: string;
  taskTypeLabel: string;
  topic: string;
  modeLabel: string;
  overall: number;
  criteria: Array<{ label: string; score: number }>;
  /** Markdown. */
  generalComment: string;
  feedback: EmailCriterionText[];
  /** The student's essay as submitted. */
  body: string;
  /** All tagged errors (placed ones are marked in the essay). */
  errors: EmailError[];
  rewriteDue: string | null;
  url: string;
  resent: boolean;
  /** The teacher's sample essay, if any, with why it scores higher per criterion. */
  sample?: { text: string; band: number; analysis: EmailCriterionText[] } | null;
  /**
   * Gmail cuts messages over about 100 KB. When the full email would be that long, the sample
   * essay and the list of errors are left out and the student is pointed to the website.
   */
  compact?: boolean;
}

/** Past this many characters the full email is replaced by the compact one. */
const MAX_HTML_LENGTH = 90_000;

const h2 = (text: string) =>
  `<h2 style="font-size:19px;line-height:1.3;margin:28px 0 10px;padding-top:14px;border-top:2px solid #e5e7eb;color:#111827">${e(text)}</h2>`;

/** Text with line breaks, for an essay (paragraphs are separated by blank lines). */
function essayHtml(text: string): string {
  return e(text).replace(/\r\n?|\n/g, '<br>');
}

function card(title: string, crit: Criterion | null, markdown: string): string {
  const c = crit ? CRIT_COLOURS[crit] : NEUTRAL;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;border-collapse:collapse"><tr>
<td width="5" bgcolor="${c.line}" style="width:5px;font-size:0;line-height:0">&nbsp;</td>
<td style="padding:14px 16px;background:${c.soft};font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#111827">
${title ? `<p style="margin:0 0 10px;padding-bottom:8px;border-bottom:2px solid #ffffff;font-size:19px;font-weight:bold;line-height:1.25;color:${c.accent}">${e(title)}</p>` : ''}
${markdownToEmailHtml(markdown, { accent: c.accent })}
</td></tr></table>`;
}

/** The criterion cards that have text. */
function cards(items: EmailCriterionText[]): string {
  return items
    .filter((x) => x.text.trim())
    .map((x) => card(x.label, x.key, x.text))
    .join('\n');
}

const legend = () =>
  `<p style="margin:0 0 10px;font-size:14px;color:#4b5563">Highlight colours: ${CRITERIA.map(
    (c) =>
      `<span style="background:${CRIT_COLOURS[c].mark};border-bottom:2px solid ${CRIT_COLOURS[c].line};padding:1px 6px;margin-right:4px;font-size:13px;color:#111827">${e(CRITERION_SHORT[c])}</span>`,
  ).join(' ')}</p>`;

/** The pieces of the corrected essay: struck-through wrong words, then the correction. */
function correctedPieces(body: string, errors: EmailError[]) {
  const byId = new Map(errors.map((x) => [x.id, x]));
  return inlineLayout(body, errors).map((piece) => ({
    piece,
    error: piece.kind === 'error' ? byId.get(piece.id) : undefined,
  }));
}

function correctedEssayHtml(body: string, errors: EmailError[]): string {
  const html = correctedPieces(body, errors)
    .map(({ piece, error }) => {
      if (piece.kind === 'text') return essayHtml(piece.text);
      const c = error?.criterion ? CRIT_COLOURS[error.criterion] : NEUTRAL;
      const mark = `background:${c.mark};border-bottom:2px solid ${c.line};padding:0 2px`;
      if (!piece.struck) return `<span style="${mark}">${essayHtml(piece.original)}</span>`;
      const fix = piece.replacement
        ? `<span style="background:#f0fdf4;color:#15803d;font-weight:bold;padding:0 3px"> ${e(piece.replacement)}</span>`
        : '';
      return `<span style="${mark}"><span style="text-decoration:line-through;color:#4b5563">${essayHtml(piece.original)}</span></span>${fix}`;
    })
    .join('');
  return `<div style="margin:0 0 14px;padding:14px 16px;background:#ffffff;border:1px solid #e5e7eb;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:#111827">${html}</div>`;
}

function correctedEssayText(body: string, errors: EmailError[]): string {
  return correctedPieces(body, errors)
    .map(({ piece }) => {
      if (piece.kind === 'text') return piece.text;
      return piece.struck
        ? `[${piece.original} -> ${piece.replacement || '(delete)'}]`
        : `[${piece.original}]`;
    })
    .join('');
}

function errorListHtml(errors: EmailError[]): string {
  if (!errors.length) return '<p style="margin:0 0 12px">No errors were tagged in this essay.</p>';
  const items = errors
    .map((x) => {
      const c = x.criterion ? CRIT_COLOURS[x.criterion] : NEUTRAL;
      const badge = x.criterion
        ? ` <span style="background:${c.mark};color:${c.accent};padding:1px 6px;font-size:12px;font-weight:bold">${e(CRITERION_SHORT[x.criterion])}</span>`
        : '';
      const fix = x.correction
        ? ` → <span style="color:#15803d;font-weight:bold">${e(x.correction)}</span>`
        : '';
      const note = x.note
        ? `<br><span style="font-size:14px;color:#4b5563">${e(x.note)}</span>`
        : '';
      return `<li style="margin-bottom:10px"><strong>${e(x.category)}</strong>${badge}<br>“${e(x.excerpt)}”${fix}${note}</li>`;
    })
    .join('');
  return `<ol style="margin:0 0 12px;padding-left:22px">${items}</ol>`;
}

function errorListText(errors: EmailError[]): string[] {
  return errors.flatMap((x, i) => [
    `${i + 1}. ${x.category}: "${x.excerpt}"${x.correction ? ` -> ${x.correction}` : ''}`,
    ...(x.note ? [`   ${x.note}`] : []),
  ]);
}

/** Section text with its Markdown removed. */
const criterionText = (items: EmailCriterionText[]): string[] =>
  items
    .filter((x) => x.text.trim())
    .flatMap((x) => ['', x.label.toUpperCase(), markdownToPlainText(x.text)]);

export function resultEmail(d: ResultEmailData): MailMessage {
  const full = buildResultEmail(d, false);
  return !d.compact && full.html.length > MAX_HTML_LENGTH ? buildResultEmail(d, true) : full;
}

function buildResultEmail(d: ResultEmailData, compact: boolean): MailMessage {
  const rows = d.criteria
    .map(
      (c) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${e(c.label)}</td><td align="right" style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-weight:bold">${e(formatBand(c.score))}</td></tr>`,
    )
    .join('');
  const rewrite = d.rewriteDue
    ? `<p style="margin:12px 0;padding:12px;background:#fef3c7;color:#78350f">Rewrite required by <strong>${e(d.rewriteDue)}</strong>.</p>`
    : '';
  const sample = !compact && d.sample?.text.trim() ? d.sample : null;
  const placed = [...d.errors].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  const feedbackBlocks = [
    d.generalComment.trim() ? card('', null, d.generalComment) : '',
    cards(d.feedback),
  ].filter(Boolean);
  const blocks = [
    p(`Hi ${d.name},`),
    p(`${d.taskTypeLabel} · ${d.topic} · ${d.modeLabel}`),
    `<p style="margin:0 0 12px;font-size:28px;font-weight:bold;color:#c2410c">Overall band ${e(formatBand(d.overall))}</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 12px">${rows}</table>`,
    rewrite,
    feedbackBlocks.length ? h2('Feedback') : '',
    ...feedbackBlocks,
    d.body.trim()
      ? [
          h2('Your essay'),
          p(
            'Struck-through words are wrong; the correction follows them in green. Each mark is explained in the list of errors below.',
          ),
          legend(),
          correctedEssayHtml(d.body, placed),
        ].join('\n')
      : '',
    compact ? '' : [h2(`Errors (${placed.length})`), errorListHtml(placed)].join('\n'),
    sample
      ? [
          h2(`Sample essay · Band ${formatBand(sample.band)}`),
          p(
            'Your teacher wrote this sample to show how your essay could be improved. Compare it with your own essay.',
          ),
          `<div style="margin:0 0 14px;padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;color:#111827">${essayHtml(sample.text)}</div>`,
          sample.analysis.some((x) => x.text.trim())
            ? `<h3 style="font-size:17px;margin:18px 0 10px">Why the sample scores higher</h3>${cards(sample.analysis)}`
            : '',
        ].join('\n')
      : '',
    compact
      ? p(
          'This message is too long to show everything, so the list of errors and the sample essay are on the website.',
        )
      : '',
  ];
  const text = [
    `Hi ${d.name},`,
    '',
    `${d.taskTypeLabel} · ${d.topic} · ${d.modeLabel}`,
    `Overall band: ${formatBand(d.overall)}`,
    ...d.criteria.map((c) => `${c.label}: ${formatBand(c.score)}`),
    ...(d.rewriteDue ? ['', `Rewrite required by ${d.rewriteDue}.`] : []),
    ...(d.generalComment.trim() || d.feedback.some((x) => x.text.trim())
      ? [
          '',
          'FEEDBACK',
          ...(d.generalComment.trim() ? ['', markdownToPlainText(d.generalComment)] : []),
        ]
      : []),
    ...criterionText(d.feedback),
    ...(d.body.trim()
      ? [
          '',
          'YOUR ESSAY',
          'Wrong words are in [brackets]; the correction follows the arrow.',
          '',
          correctedEssayText(d.body, placed),
        ]
      : []),
    ...(compact ? [] : ['', `ERRORS (${placed.length})`, ...errorListText(placed)]),
    ...(sample
      ? [
          '',
          `SAMPLE ESSAY · BAND ${formatBand(sample.band)}`,
          sample.text.trim(),
          ...(sample.analysis.some((x) => x.text.trim())
            ? ['', 'Why the sample scores higher:', ...criterionText(sample.analysis)]
            : []),
        ]
      : []),
    ...(compact
      ? [
          '',
          'This message is too long to show everything, so the list of errors and the sample essay are on the website.',
        ]
      : []),
  ];
  return layout({
    to: d.to,
    subject: `${d.resent ? 'Updated score' : 'Your score'}: ${d.taskTypeLabel} – Band ${formatBand(d.overall)}`,
    preheader:
      `Overall band ${formatBand(d.overall)} for your ${d.taskTypeLabel} essay on ${d.topic}. ${markdownToPlainText(d.generalComment).replace(/\s+/g, ' ').slice(0, 100)}`.trim(),
    heading: d.resent ? 'Your essay score was updated' : 'Your essay has been scored',
    blocks,
    button: { label: 'Open on the website', url: d.url },
    text,
  });
}

export function rewriteReminderEmail(d: {
  to: string;
  name: string;
  topic: string;
  due: string;
  overdue: boolean;
  url: string;
}): MailMessage {
  const subject = d.overdue ? 'Your rewrite is overdue' : 'Reminder: your rewrite is due soon';
  const line = d.overdue
    ? `Your rewrite for the essay on ${d.topic} was due ${d.due}. You can still submit it; it will be marked late.`
    : `Your rewrite for the essay on ${d.topic} is due ${d.due}.`;
  return layout({
    to: d.to,
    subject,
    preheader: line,
    heading: subject,
    blocks: [p(`Hi ${d.name},`), p(line)],
    button: { label: 'Open the essay', url: d.url },
    text: [`Hi ${d.name},`, '', line],
  });
}

/**
 * One reminder for many students, sent with everyone in BCC. It cannot name the
 * essay or the deadline (those differ per student), so it points to the dashboard.
 */
export function rewriteReminderBatchEmail(d: {
  bcc: string[];
  overdue: boolean;
  url: string;
}): MailMessage {
  const subject = d.overdue ? 'Your rewrite is overdue' : 'Reminder: your rewrite is due soon';
  const line = d.overdue
    ? 'You have a rewrite that is past its deadline. You can still submit it; it will be marked late.'
    : 'You have a rewrite that is due within the next 2 days.';
  const where = 'Open your dashboard to see which essay it is and the exact deadline.';
  return {
    ...layout({
      to: '',
      subject,
      preheader: line,
      heading: subject,
      blocks: [p('Hi,'), p(line), p(where)],
      button: { label: 'Open my dashboard', url: d.url },
      text: ['Hi,', '', line, where],
    }),
    bcc: d.bcc,
  };
}

interface AssignmentEmailData {
  title: string;
  taskTypeLabel: string;
  minutes: number;
  closes: string;
  url: string;
}

function assignmentLayout(d: AssignmentEmailData, to: string, greeting: string): MailMessage {
  const line = `${d.title} (${d.taskTypeLabel}, ${d.minutes} minutes) is open until ${d.closes}. The prompt appears when you press "Start test", and the timer starts straight away.`;
  return layout({
    to,
    subject: `New writing test: ${d.title}`,
    preheader: line,
    heading: 'You have a new writing test',
    blocks: [p(greeting), p(line)],
    button: { label: 'Go to Assigned to me', url: d.url },
    text: [greeting, '', line],
  });
}

export function assignmentEmail(
  d: AssignmentEmailData & { to: string; name: string },
): MailMessage {
  return assignmentLayout(d, d.to, `Hi ${d.name},`);
}

/** The same notice for many students (same test, same time zone), everyone in BCC. */
export function assignmentBatchEmail(d: AssignmentEmailData & { bcc: string[] }): MailMessage {
  return { ...assignmentLayout(d, '', 'Hi,'), bcc: d.bcc };
}
