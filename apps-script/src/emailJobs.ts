// Builders for every email type. Content is never stored: a queued or failed
// email is rebuilt from its EmailEvents row (type + idempotency key).
import {
  CRITERIA,
  criterionLabel,
  MODE_LABELS,
  type Mode,
  TASK_TYPE_LABELS,
  type TaskType,
} from '../../shared/constants';
import { formatForEmail, assignmentNoticeJob } from './handlers/assignments';
import { loginJob } from './auth';
import { appUrl, type Ctx, type EssayRow, topicLabel } from './context';
import { type EmailJob, type EmailType, parseEmailKey } from './email';
import { resultEmail, rewriteReminderEmail } from './emailTemplates';
import type { Row } from './schema';
import { errorsView, rewriteRequestFor, scoreView } from './views';

/** Plain-text summary of Markdown feedback for the email (full feedback stays behind login). */
export function summarize(markdownText: string, max = 400): string {
  const plain = markdownText
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~[\]()!-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** The 3 most frequent error categories in this essay, with one example correction each. */
export function topErrors(ctx: Ctx, essayId: string, limit = 3) {
  const errors = errorsView(ctx, essayId);
  const groups = new Map<string, typeof errors>();
  for (const e of errors) {
    const list = groups.get(e.category) ?? [];
    list.push(e);
    groups.set(e.category, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category, list]) => ({
      category,
      count: list.length,
      excerpt: list[0].excerpt,
      correction: list[0].correction,
    }));
}

export function resultJob(
  ctx: Ctx,
  essay: EssayRow,
  type: 'result' | 'result_resent',
  version: string,
): EmailJob {
  const student = ctx.db.byId('Users', essay.student_id);
  if (!student) throw new Error('Student not found');
  return {
    type,
    refId: essay.id,
    version,
    userId: student.id,
    essayId: essay.id,
    build: () => {
      const score = scoreView(ctx, essay.id);
      if (!score) throw new Error('This essay has no score');
      const taskType = essay.task_type as TaskType;
      const rr = rewriteRequestFor(ctx, essay.id);
      const rewriteDue =
        rr && (rr.status === 'requested' || rr.status === 'overdue')
          ? formatForEmail(ctx, rr.due_at, student.timezone)
          : null;
      return resultEmail({
        to: student.email,
        name: student.name,
        taskTypeLabel: TASK_TYPE_LABELS[taskType],
        topic: topicLabel(ctx, essay.topic_id),
        modeLabel: MODE_LABELS[essay.mode as Mode] ?? essay.mode,
        overall: score.overall,
        criteria: CRITERIA.map((c) => ({
          label: criterionLabel(c, taskType),
          score: score.criteria[c],
        })),
        summary: summarize(score.generalComment),
        topErrors: topErrors(ctx, essay.id),
        rewriteDue,
        url: appUrl(ctx, `/essays/${essay.id}`),
        resent: type === 'result_resent',
      });
    },
  };
}

export function rewriteJob(
  ctx: Ctx,
  rr: Row<'RewriteRequests'>,
  type: 'rewrite_reminder' | 'rewrite_overdue',
): EmailJob {
  const essay = ctx.db.byId('Essays', rr.essay_id);
  const student = essay ? ctx.db.byId('Users', essay.student_id) : undefined;
  if (!essay || !student) throw new Error('Essay or student not found');
  return {
    type,
    refId: rr.id,
    version: '1',
    userId: student.id,
    essayId: essay.id,
    build: () =>
      rewriteReminderEmail({
        to: student.email,
        name: student.name,
        topic: topicLabel(ctx, essay.topic_id),
        due: formatForEmail(ctx, rr.due_at, student.timezone),
        overdue: type === 'rewrite_overdue',
        url: appUrl(ctx, `/essays/${essay.id}`),
      }),
  };
}

/** Recreate the job for a queued or failed EmailEvents row. */
export function jobFromEvent(ctx: Ctx, event: Row<'EmailEvents'>): EmailJob | null {
  const { type, refId, version } = parseEmailKey(event.idempotency_key);
  switch (type as EmailType) {
    case 'login': {
      const user = ctx.db.byId('Users', refId);
      return user ? loginJob(ctx, user, version) : null;
    }
    case 'result':
    case 'result_resent': {
      const essay = ctx.db.byId('Essays', refId);
      if (!essay || essay.status !== 'scored') return null;
      return resultJob(ctx, essay, type as 'result' | 'result_resent', version);
    }
    case 'rewrite_reminder':
    case 'rewrite_overdue': {
      const rr = ctx.db.byId('RewriteRequests', refId);
      if (!rr || rr.status === 'waived' || rr.status === 'submitted') return null;
      return rewriteJob(ctx, rr, type as 'rewrite_reminder' | 'rewrite_overdue');
    }
    case 'assignment_notice': {
      const a = ctx.db.byId('Assignments', refId);
      const student = ctx.db.byId('Users', version);
      return a && student ? assignmentNoticeJob(ctx, a, student) : null;
    }
    default:
      return null;
  }
}
