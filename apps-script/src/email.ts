// Gmail pipeline: idempotency keys, daily quota with a queue, attempt log.
// Callers already hold the script lock (every write request and every
// trigger runs inside LockService.getScriptLock()).
import { getNumberSetting, type Ctx } from './context';
import type { Row } from './schema';
import type { MailMessage } from './services';

export const EMAIL_TYPES = [
  'login',
  'password_reset',
  'result',
  'result_resent',
  'rewrite_reminder',
  'rewrite_overdue',
  'assignment_notice',
] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

/** 'no_email': the student has no email address (added by the teacher), so nothing is sent. */
export type SendOutcome = 'sent' | 'duplicate' | 'queued' | 'failed' | 'no_email';

export interface EmailJob {
  type: EmailType;
  /** ID the email is about: essay, rewrite request, assignment or user. */
  refId: string;
  /** Send version: makes the key unique per intended send. */
  version: string;
  userId: string;
  essayId?: string;
  /** Recipient address; empty for students the teacher added without an email. */
  to: string;
  build: () => MailMessage;
  /**
   * Set on reminders: builds one message for many students of the same type, with
   * the given addresses in BCC. Such jobs are sent together by sendEmailBatch.
   */
  batch?: (bcc: string[]) => MailMessage;
}

/** Most distinct students in one BCC message. */
export const MAX_BCC = 50;

export function emailKey(type: EmailType, refId: string, version: string): string {
  return `${type}:${refId}:${version}`;
}

export function parseEmailKey(key: string): { type: EmailType; refId: string; version: string } {
  const [type, refId, ...rest] = key.split(':');
  return { type: type as EmailType, refId, version: rest.join(':') };
}

/** Reminder types, sent as BCC batches. */
const BATCH_TYPES: ReadonlySet<string> = new Set(['rewrite_reminder', 'rewrite_overdue']);

/** Login and reset links always go first; other email keeps a reserve of quota for them. */
function isAccessEmail(type: string): boolean {
  return type === 'login' || type === 'password_reset';
}

export function hasQuotaFor(ctx: Ctx, type: EmailType): boolean {
  const remaining = ctx.svc.mail.remainingQuota();
  if (isAccessEmail(type)) return remaining > 0;
  return remaining > getNumberSetting(ctx, 'email_quota_reserve');
}

function record(
  ctx: Ctx,
  job: EmailJob,
  status: 'sent' | 'failed' | 'queued',
  error = '',
): Row<'EmailEvents'> {
  return ctx.db.insert('EmailEvents', {
    id: ctx.svc.uuid(),
    essay_id: job.essayId ?? '',
    user_id: job.userId,
    type: job.type,
    idempotency_key: emailKey(job.type, job.refId, job.version),
    status,
    error: error.slice(0, 500),
    created_at: ctx.nowIso,
  });
}

export function sendEmail(ctx: Ctx, job: EmailJob): SendOutcome {
  if (!job.to) return 'no_email';
  const key = emailKey(job.type, job.refId, job.version);
  const previous = ctx.db.find('EmailEvents', (e) => e.idempotency_key === key);
  if (previous.some((e) => e.status === 'sent')) return 'duplicate';
  if (previous.some((e) => e.status === 'queued')) return 'queued';
  if (!hasQuotaFor(ctx, job.type)) {
    record(ctx, job, 'queued');
    return 'queued';
  }
  try {
    ctx.svc.mail.send(job.build());
    record(ctx, job, 'sent');
    return 'sent';
  } catch (err) {
    record(ctx, job, 'failed', (err as Error).message);
    return 'failed';
  }
}

interface BatchResult {
  job: EmailJob;
  /** 'unsent': no quota left for it yet. */
  status: 'sent' | 'failed' | 'unsent';
  error: string;
}

/**
 * Send jobs that have a `batch` builder as BCC messages: one per type and per
 * MAX_BCC students, as many as the quota allows. Gmail counts every BCC
 * recipient plus the teacher's own To copy against the daily quota. Jobs that
 * do not fit come back 'unsent' for the caller to queue.
 */
function deliverBatch(ctx: Ctx, jobs: EmailJob[]): BatchResult[] {
  const results: BatchResult[] = jobs.map((job) => ({ job, status: 'unsent', error: '' }));
  const byType = new Map<string, BatchResult[]>();
  for (const r of results) byType.set(r.job.type, [...(byType.get(r.job.type) ?? []), r]);
  const reserve = getNumberSetting(ctx, 'email_quota_reserve');
  for (const group of byType.values()) {
    let pos = 0;
    while (pos < group.length) {
      const room = ctx.svc.mail.remainingQuota() - reserve - 1; // 1 = the To copy
      const limit = Math.min(MAX_BCC, room);
      if (limit <= 0) return results;
      const chunk: BatchResult[] = [];
      const addresses = new Map<string, string>(); // one student may have two reminders
      for (; pos < group.length; pos++) {
        const address = group[pos].job.to;
        if (!addresses.has(address.toLowerCase()) && addresses.size >= limit) break;
        addresses.set(address.toLowerCase(), address);
        chunk.push(group[pos]);
      }
      try {
        ctx.svc.mail.send(chunk[0].job.batch!([...addresses.values()]));
        for (const r of chunk) r.status = 'sent';
      } catch (err) {
        for (const r of chunk) {
          r.status = 'failed';
          r.error = (err as Error).message.slice(0, 500);
        }
      }
    }
  }
  return results;
}

/**
 * Send reminders to many students with one BCC message instead of one email each.
 * Every student still gets their own EmailEvents row, so each reminder is sent at
 * most once, and failed or queued ones are retried later like any other email.
 */
export function sendEmailBatch(ctx: Ctx, jobs: EmailJob[]): Partial<Record<SendOutcome, number>> {
  const outcomes: Partial<Record<SendOutcome, number>> = {};
  const count = (o: SendOutcome) => (outcomes[o] = (outcomes[o] ?? 0) + 1);
  const ready: EmailJob[] = [];
  for (const job of jobs) {
    if (!job.to) {
      count('no_email');
      continue;
    }
    const key = emailKey(job.type, job.refId, job.version);
    const previous = ctx.db.find('EmailEvents', (e) => e.idempotency_key === key);
    if (previous.some((e) => e.status === 'sent')) count('duplicate');
    else if (previous.some((e) => e.status === 'queued')) count('queued');
    else ready.push(job);
  }
  for (const { job, status, error } of deliverBatch(ctx, ready)) {
    record(ctx, job, status === 'unsent' ? 'queued' : status, error);
    count(status === 'unsent' ? 'queued' : status);
  }
  return outcomes;
}

/**
 * Send queued email while quota allows, login links first, oldest first.
 * `rebuild` recreates the job from the stored event (content is never stored).
 */
export function processEmailQueue(
  ctx: Ctx,
  rebuild: (event: Row<'EmailEvents'>) => EmailJob | null,
): { sent: number; failed: number; remaining: number } {
  const queued = ctx.db
    .find('EmailEvents', (e) => e.status === 'queued')
    .sort((a, b) => {
      const pa = isAccessEmail(a.type) ? 0 : 1;
      const pb = isAccessEmail(b.type) ? 0 : 1;
      return pa - pb || a.created_at.localeCompare(b.created_at);
    });
  let sent = 0;
  let failed = 0;
  // Queued reminders are sent together at the end, after the one-to-one email.
  const batched: Array<{ event: Row<'EmailEvents'>; job: EmailJob }> = [];
  for (const event of queued) {
    if (!BATCH_TYPES.has(event.type) && !hasQuotaFor(ctx, event.type as EmailType)) continue;
    const alreadySent = ctx.db.findOne(
      'EmailEvents',
      (e) => e.idempotency_key === event.idempotency_key && e.status === 'sent',
    );
    if (alreadySent) {
      ctx.db.update('EmailEvents', (e) => e.id === event.id, {
        status: 'sent',
        error: 'duplicate',
      });
      continue;
    }
    let status: 'sent' | 'failed' = 'sent';
    let error = '';
    try {
      const job = rebuild(event);
      if (!job) throw new Error('Nothing to send any more');
      if (!job.to) throw new Error('The student has no email address');
      if (job.batch) {
        batched.push({ event, job });
        continue;
      }
      ctx.svc.mail.send(job.build());
      sent++;
    } catch (err) {
      status = 'failed';
      error = (err as Error).message.slice(0, 500);
      failed++;
    }
    ctx.db.update('EmailEvents', (e) => e.id === event.id, { status, error });
  }
  const delivered = deliverBatch(
    ctx,
    batched.map((b) => b.job),
  );
  delivered.forEach((r, i) => {
    if (r.status === 'unsent') return; // stays queued
    ctx.db.update('EmailEvents', (e) => e.id === batched[i].event.id, {
      status: r.status,
      error: r.error,
    });
    if (r.status === 'sent') sent++;
    else failed++;
  });
  const remaining = ctx.db.find('EmailEvents', (e) => e.status === 'queued').length;
  return { sent, failed, remaining };
}
