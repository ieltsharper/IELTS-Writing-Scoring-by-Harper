// Passwordless login: emailed single-use links and 30-day sessions.
// Only SHA-256 hashes of tokens are stored.
import { ApiError, appUrl, type Ctx, isAdminEmail, type UserRow } from './context';
import { loginEmail } from './emailTemplates';
import { type EmailJob, sendEmail } from './email';

export const LOGIN_TOKEN_MINUTES = 15;
export const SESSION_DAYS = 30;
export const RATE_PER_EMAIL = 3;
export const RATE_GLOBAL = 30;
export const LOGIN_LINK_MESSAGE = 'If that email is registered, a link is on its way.';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'admin';
  row: UserRow;
}

export function newToken(ctx: Ctx): string {
  return `${ctx.svc.uuid()}${ctx.svc.uuid()}`.replace(/-/g, '');
}

/** Role always comes from ADMIN_EMAIL, never from client input or the stored row. */
export function toAuthUser(ctx: Ctx, row: UserRow): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: isAdminEmail(ctx, row.email) ? 'admin' : 'student',
    row,
  };
}

interface Window {
  count: number;
  resetAt: number;
}

/** Fixed one-hour windows in CacheService. Returns false when the limit is reached. */
export function takeRate(ctx: Ctx, key: string, limit: number): boolean {
  const nowMs = ctx.now.getTime();
  const raw = ctx.svc.cache.get(key);
  let w: Window = raw ? (JSON.parse(raw) as Window) : { count: 0, resetAt: nowMs + 3600000 };
  if (w.resetAt <= nowMs) w = { count: 0, resetAt: nowMs + 3600000 };
  if (w.count >= limit) return false;
  w.count++;
  const ttl = Math.max(1, Math.ceil((w.resetAt - nowMs) / 1000));
  ctx.svc.cache.put(key, JSON.stringify(w), ttl);
  return true;
}

export function loginJob(ctx: Ctx, user: UserRow, version: string): EmailJob {
  return {
    type: 'login',
    refId: user.id,
    version,
    userId: user.id,
    build: () => {
      // The token is created at send time, so a queued link is still fresh when it goes out.
      const token = newToken(ctx);
      ctx.db.insert('LoginTokens', {
        token_hash: ctx.svc.sha256Hex(token),
        user_id: user.id,
        expires_at: new Date(ctx.now.getTime() + LOGIN_TOKEN_MINUTES * 60000).toISOString(),
        used_at: '',
      });
      return loginEmail(
        user.email,
        user.name,
        appUrl(ctx, `/auth?token=${encodeURIComponent(token)}`),
      );
    },
  };
}

/** Always resolves to the same message so it never reveals whether an email exists. */
export function requestLoginLink(ctx: Ctx, email: string): { message: string } {
  const normalized = email.trim().toLowerCase();
  const emailKey = `rl:email:${ctx.svc.sha256Hex(normalized).slice(0, 32)}`;
  const allowed =
    takeRate(ctx, 'rl:global', RATE_GLOBAL) && takeRate(ctx, emailKey, RATE_PER_EMAIL);
  if (allowed) {
    const user = ctx.db.findOne('Users', (u) => u.email.toLowerCase() === normalized);
    if (user) sendEmail(ctx, loginJob(ctx, user, ctx.svc.uuid()));
  }
  return { message: LOGIN_LINK_MESSAGE };
}

export function exchangeLoginToken(
  ctx: Ctx,
  token: string,
): { sessionToken: string; user: AuthUser } {
  const hash = ctx.svc.sha256Hex(token);
  const row = ctx.db.findOne('LoginTokens', (t) => t.token_hash === hash);
  if (!row || row.used_at || Date.parse(row.expires_at) <= ctx.now.getTime()) {
    throw new ApiError(
      'unauthenticated',
      'This login link is invalid or has expired. Please request a new one.',
    );
  }
  const userRow = ctx.db.byId('Users', row.user_id);
  if (!userRow) throw new ApiError('unauthenticated', 'This account no longer exists.');
  ctx.db.update('LoginTokens', (t) => t.token_hash === hash, { used_at: ctx.nowIso });
  // Housekeeping: drop expired tokens and sessions.
  const nowMs = ctx.now.getTime();
  ctx.db.remove('LoginTokens', (t) => Date.parse(t.expires_at) < nowMs - 86400000);
  ctx.db.remove('Sessions', (s) => Date.parse(s.expires_at) < nowMs);

  const sessionToken = newToken(ctx);
  ctx.db.insert('Sessions', {
    token_hash: ctx.svc.sha256Hex(sessionToken),
    user_id: userRow.id,
    expires_at: new Date(nowMs + SESSION_DAYS * 86400000).toISOString(),
    created_at: ctx.nowIso,
  });
  return { sessionToken, user: toAuthUser(ctx, userRow) };
}

export function userFromSession(ctx: Ctx, sessionToken: string | undefined): AuthUser | null {
  if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.length > 128) return null;
  const hash = ctx.svc.sha256Hex(sessionToken);
  const session = ctx.db.findOne('Sessions', (s) => s.token_hash === hash);
  if (!session || Date.parse(session.expires_at) <= ctx.now.getTime()) return null;
  const row = ctx.db.byId('Users', session.user_id);
  return row ? toAuthUser(ctx, row) : null;
}

export function logout(ctx: Ctx, sessionToken: string): void {
  const hash = ctx.svc.sha256Hex(sessionToken);
  ctx.db.remove('Sessions', (s) => s.token_hash === hash);
}
