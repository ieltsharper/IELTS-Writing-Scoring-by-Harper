// Essays written in IELTS Harper Portal (the daily writing task) arrive here and join the
// normal queue and scoring flow, exactly like an essay added by the teacher.
//
// Server-to-server only: the portal's Apps Script sends the shared secret (Script Property
// PORTAL_SECRET here, HARPER_SECRET in the portal). Browsers never see it. A retried request
// with the same submissionId returns the essay created the first time.
import { LIMITS, TASK_TYPES, type TaskType } from '../../../shared/constants';
import { checkImage } from '../../../shared/image';
import { countWords } from '../../../shared/wordCount';
import { categoryColumns, readCategory } from '../category';
import { adminTimezone, ApiError, type Ctx } from '../context';
import { saveUploadedImage } from '../drive';
import type { ActionDef } from '../router';
import { Reader } from '../validate';
import { finalizeSubmission } from './essays';

/** Compares two strings in time that does not depend on where they first differ. */
function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function importEssay(ctx: Ctx, payload: unknown) {
  const expected = ctx.svc.props.PORTAL_SECRET ?? '';
  const r = new Reader(payload);
  const secret = r.str('secret', { max: 200 });
  if (expected.length < 32 || !sameSecret(secret, expected)) {
    throw new ApiError('forbidden', 'Not allowed.');
  }
  const submissionId = r.str('submissionId', { min: 8, max: 64 });
  const email = r.email('studentEmail');
  const name = r.str('studentName', { max: LIMITS.name, min: 1 });
  const taskType = r.oneOf('taskType', TASK_TYPES) as TaskType;
  const category = readCategory(ctx, r, taskType, { activeTopicsOnly: false });
  const prompt = r.str('prompt', { max: LIMITS.prompt, min: 10 });
  const body = r.str('body', { max: LIMITS.body, trim: false });
  const mode = r.oneOf('mode', ['practice', 'test'] as const) as 'practice' | 'test';
  const startedAt = r.isoTime('startedAt', true);
  // When the student submitted (a retried request can arrive later): used for test timing.
  const submittedAt = r.isoTime('submittedAt', true);
  const autoSubmitted = r.has('autoSubmitted') ? r.bool('autoSubmitted') : false;
  const pasteAttempts = r.int('pasteAttempts', { min: 0, max: 10000, optional: true }) ?? 0;
  const imageR = r.object('image', true);
  let image: { base64: string; mimeType: string; name: string } | null = null;
  if (imageR) {
    image = {
      base64: imageR.str('base64', { max: 7_100_000 }),
      mimeType: imageR.str('mimeType', { max: 20 }),
      name: (imageR.str('name', { max: 120, optional: true }) || 'chart').replace(/[^\w .-]/g, '_'),
    };
    r.absorb('image', imageR);
    const problem = checkImage(image);
    if (problem) r.addError('image', problem);
  }
  if (taskType === 'task1_academic' && !image) {
    r.addError('image', 'Task 1 Academic needs the chart or diagram image.');
  }
  if (taskType === 'task2' && image) r.addError('image', 'Task 2 essays do not have an image');
  if (mode === 'test' && !startedAt) {
    r.addError('startedAt', 'Test mode needs the start time.');
  }
  r.done();

  const source = `portal:${submissionId}`;
  const existing = ctx.db.findOne('Essays', (e) => e.source === source);
  if (existing) return { essayId: existing.id, duplicate: true };

  let student = ctx.db.findOne('Users', (u) => u.email.toLowerCase() === email);
  if (student && student.role === 'admin') {
    throw new ApiError('bad_request', 'This email belongs to an admin account.');
  }
  if (!student) {
    // A portal student without a Harper account: create one (they can log in to Harper later
    // with this email to read their feedback).
    student = ctx.db.insert('Users', {
      id: ctx.svc.uuid(),
      name,
      email,
      class: '',
      role: 'student',
      target_band: '',
      exam_date: '',
      timezone: adminTimezone(ctx),
      consent_at: '',
      created_at: ctx.nowIso,
    });
  }
  const essay = ctx.db.insert('Essays', {
    id: ctx.svc.uuid(),
    student_id: student.id,
    parent_essay_id: '',
    mode,
    assignment_id: '',
    started_at: mode === 'test' ? new Date(startedAt).toISOString() : '',
    time_used_seconds: '',
    auto_submitted: false,
    over_time: false,
    paste_attempts: pasteAttempts,
    task_type: taskType,
    ...categoryColumns(category),
    prompt,
    body,
    word_count: countWords(body),
    image_file_id: image ? saveUploadedImage(ctx, image) : '',
    status: 'draft',
    drive_folder_id: '',
    drive_sync_status: '',
    saved_at: ctx.nowIso,
    submitted_at: '',
    scored_at: '',
    test_date: '',
    source,
  });
  const submitted = finalizeSubmission(ctx, essay, {
    autoSubmitted,
    at: submittedAt || undefined,
  });
  return { essayId: submitted.id, duplicate: false, driveStatus: submitted.drive_sync_status };
}

export const portalImportActions: Record<string, ActionDef> = {
  'portal.essays.import': { write: true, handler: (ctx, p) => importEssay(ctx, p) },
};
