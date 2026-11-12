// The AI pre-check that IELTS Harper Portal runs on practice essays before they are sent here
// (owner, 2026-11-13): Gemini marks vocabulary (LR) and grammar (GRA) errors, the student
// fixes each one or marks it "I think this is correct", and can then send the essay. The
// portal sends the history with the essay; it is stored as JSON in Essays.precheck_json and
// shown to the teacher on the scoring page (first draft, errors, what the student did).

export type PrecheckStatus = 'open' | 'fixed' | 'dismissed';

export interface PrecheckError {
  /** Which check found it (1 = the first draft). */
  round: number;
  criterion: 'LR' | 'GRA';
  type: string;
  excerpt: string;
  correction: string;
  hint: string;
  /** fixed = the student changed the words; dismissed = "I think this is correct". */
  status: PrecheckStatus;
  /** The student asked to see the correction. */
  revealed: boolean;
}

export interface Precheck {
  /** The essay as it was at the first check ('' when it did not fit in the cell). */
  firstDraft: string;
  firstAt: string;
  checks: number;
  /** Why the AI could not check ('limit', 'busy', ...): the student sent it unchecked. */
  unavailable: string | null;
  errors: PrecheckError[];
}

/** A Google Sheets cell holds 50,000 characters; keep a margin. */
export const PRECHECK_MAX_CHARS = 48_000;
const MAX_ERRORS = 60;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Reads the portal's pre-check leniently (bad parts are dropped); null when absent. */
export function readPrecheck(raw: unknown, maxDraft = 20_000): Precheck | null {
  if (!isObj(raw)) return null;
  const errors: PrecheckError[] = [];
  for (const e of Array.isArray(raw.errors) ? raw.errors.slice(0, MAX_ERRORS) : []) {
    if (!isObj(e)) continue;
    const excerpt = text(e.excerpt, 200);
    if (!excerpt) continue;
    const round = Number(e.round);
    errors.push({
      round: Number.isInteger(round) && round > 0 && round < 100 ? round : 1,
      criterion: e.criterion === 'LR' ? 'LR' : 'GRA',
      type: text(e.type, 60),
      excerpt,
      correction: text(e.correction, 300),
      hint: text(e.hint, 400),
      status: e.status === 'fixed' || e.status === 'dismissed' ? e.status : 'open',
      revealed: e.revealed === true,
    });
  }
  const checks = Number(raw.checks);
  return {
    firstDraft: text(raw.firstDraft, maxDraft),
    firstAt: text(raw.firstAt, 40),
    checks: Number.isInteger(checks) && checks >= 0 && checks < 100 ? checks : 0,
    unavailable:
      typeof raw.unavailable === 'string' && raw.unavailable ? raw.unavailable.slice(0, 40) : null,
    errors,
  };
}

/** The JSON to store, kept under one cell: hints are shortened first, then the first draft dropped. */
export function precheckJson(p: Precheck): string {
  let json = JSON.stringify(p);
  if (json.length <= PRECHECK_MAX_CHARS) return json;
  const shorter = { ...p, errors: p.errors.map((e) => ({ ...e, hint: e.hint.slice(0, 120) })) };
  json = JSON.stringify(shorter);
  if (json.length <= PRECHECK_MAX_CHARS) return json;
  return JSON.stringify({ ...shorter, firstDraft: '' });
}

/** The stored pre-check, or null (no check, or a column that is not there yet). */
export function parsePrecheck(json: string | undefined): Precheck | null {
  if (!json) return null;
  try {
    return readPrecheck(JSON.parse(json));
  } catch {
    return null;
  }
}
