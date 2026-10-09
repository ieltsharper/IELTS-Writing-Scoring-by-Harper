// Public config, sign up, login links, sessions and the user's own account.
import { LIMITS } from '../../../shared/constants';
import {
  exchangeLoginToken,
  LOGIN_LINK_MESSAGE,
  logout,
  requestLoginLink,
  type AuthUser,
} from '../auth';
import { authorize } from '../authorize';
import { adminTimezone, ApiError, bool, type Ctx, getNumberSetting, num } from '../context';
import { clearDashboardCache } from '../dashboardCache';
import { trashEssayFiles } from '../drive';
import type { ActionDef } from '../router';
import { Reader } from '../validate';

export function publicUser(user: AuthUser) {
  const r = user.row;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    classId: r.class,
    targetBand: num(r.target_band),
    examDate: r.exam_date,
    timezone: r.timezone,
  };
}

function config(ctx: Ctx) {
  return {
    classes: ctx.db
      .find('Classes', (c) => bool(c.active))
      .map((c) => ({ id: c.id, label: c.label })),
    topics: ctx.db.find('Topics', (t) => bool(t.active)).map((t) => ({ id: t.id, label: t.label })),
    dailyCap: getNumberSetting(ctx, 'daily_submission_cap'),
    adminTimezone: adminTimezone(ctx),
  };
}

function signup(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const name = r.str('name', { max: LIMITS.name, min: 2 });
  const email = r.email('email');
  const classId = r.id('classId');
  const consent = r.bool('consent');
  const timezone = r.timezone('timezone');
  if (!consent) r.addError('consent', 'Please agree to the privacy notice to continue.');
  if (classId && !ctx.db.findOne('Classes', (c) => c.id === classId && bool(c.active))) {
    r.addError('classId', 'Choose a class from the list');
  }
  r.done();
  const exists = ctx.db.findOne('Users', (u) => u.email.toLowerCase() === email);
  if (!exists) {
    ctx.db.insert('Users', {
      id: ctx.svc.uuid(),
      name,
      email,
      class: classId,
      role: 'student',
      target_band: '',
      exam_date: '',
      timezone: timezone || adminTimezone(ctx),
      consent_at: ctx.nowIso,
      created_at: ctx.nowIso,
    });
  }
  // Same response whether or not the email was already registered.
  requestLoginLink(ctx, email);
  return { message: LOGIN_LINK_MESSAGE };
}

function updateMe(ctx: Ctx, payload: unknown, user: AuthUser) {
  authorize('me.update', user, { type: 'user', userId: user.id });
  const r = new Reader(payload);
  const name = r.str('name', { max: LIMITS.name, min: 2 });
  const targetBand = r.band('targetBand', true);
  const examDate = r.date('examDate', true);
  const timezone = r.timezone('timezone');
  r.done();
  ctx.db.update('Users', (u) => u.id === user.id, {
    name,
    target_band: targetBand ?? '',
    exam_date: examDate,
    ...(timezone ? { timezone } : {}),
  });
  clearDashboardCache(ctx, user.id);
  const row = ctx.db.byId('Users', user.id)!;
  return publicUser({ ...user, name: row.name, row });
}

/** Delete the account: rows in every tab, Drive folders to trash, sessions ended. */
export function deleteUserData(ctx: Ctx, userId: string): void {
  const { db } = ctx;
  const essays = db.find('Essays', (e) => e.student_id === userId);
  const essayIds = new Set(essays.map((e) => e.id));
  for (const essay of essays) trashEssayFiles(ctx, essay);
  const inEssays = (r: { essay_id: string }) => essayIds.has(r.essay_id);
  db.remove('Drafts', inEssays);
  db.remove('SourceFeedback', inEssays);
  db.remove('Scores', inEssays);
  db.remove('RewriteRequests', inEssays);
  db.remove('CalibrationSamples', inEssays);
  db.remove('ErrorLog', (r) => r.student_id === userId || essayIds.has(r.essay_id));
  db.remove('EmailEvents', (r) => r.user_id === userId || essayIds.has(r.essay_id));
  db.remove('Essays', (r) => r.student_id === userId);
  db.remove('LoginTokens', (r) => r.user_id === userId);
  db.remove('Sessions', (r) => r.user_id === userId);
  for (const a of db.all('Assignments')) {
    const ids = JSON.parse(a.student_ids || '[]') as string[];
    if (ids.includes(userId)) {
      db.update('Assignments', (x) => x.id === a.id, {
        student_ids: JSON.stringify(ids.filter((id) => id !== userId)),
      });
    }
  }
  db.remove('Users', (r) => r.id === userId);
  clearDashboardCache(ctx, userId);
}

function deleteMe(ctx: Ctx, payload: unknown, user: AuthUser) {
  authorize('me.delete', user, { type: 'user', userId: user.id });
  const r = new Reader(payload);
  const confirm = r.str('confirm', { max: 10 });
  if (confirm !== 'DELETE') r.addError('confirm', 'Type DELETE to confirm');
  r.done();
  if (user.role === 'admin') {
    throw new ApiError('forbidden', 'The admin account cannot be deleted from the app.');
  }
  deleteUserData(ctx, user.id);
  return { deleted: true };
}

export const accountActions: Record<string, ActionDef> = {
  'config.get': { write: false, handler: (ctx) => config(ctx) },
  'auth.signup': { write: true, handler: (ctx, p) => signup(ctx, p) },
  'auth.requestLink': {
    write: true,
    handler: (ctx, p) => {
      const r = new Reader(p);
      const email = r.str('email', { max: LIMITS.email });
      r.done();
      return requestLoginLink(ctx, email);
    },
  },
  'auth.exchange': {
    write: true,
    handler: (ctx, p) => {
      const r = new Reader(p);
      const token = r.str('token', { max: 128 });
      r.done();
      const { sessionToken, user } = exchangeLoginToken(ctx, token);
      return { sessionToken, user: publicUser(user) };
    },
  },
  'auth.logout': {
    write: true,
    handler: (ctx, _p, _u, token) => {
      logout(ctx, token);
      return { loggedOut: true };
    },
  },
  'me.get': { write: false, handler: (_ctx, _p, user) => publicUser(user!) },
  'me.update': { write: true, handler: (ctx, p, user) => updateMe(ctx, p, user!) },
  'me.delete': { write: true, handler: (ctx, p, user) => deleteMe(ctx, p, user!) },
};
