// Scoring page: the AI pre-check the student did in IELTS Harper Portal before sending a
// practice essay (shared/precheck.ts). Shows the first draft, each error the AI marked and
// what the student did with it, so the teacher can see what they corrected on their own.
import type { Precheck, PrecheckError } from '../../../shared/precheck';
import { h } from '../../dom';
import { badge, notice } from '../../ui/components';
import { formatDateTime } from '../../ui/format';

const WHY: Record<string, string> = {
  not_configured: 'the AI was not set up',
  limit: "the day's AI limit was reached",
  busy: 'the AI was busy',
  error: 'the AI returned an error',
};

function outcome(e: PrecheckError) {
  const done =
    e.status === 'fixed'
      ? badge('Fixed', 'success')
      : e.status === 'dismissed'
        ? badge('Student thinks it is correct', 'warning')
        : badge('Not fixed', 'danger');
  return h('span', null, done, e.revealed ? [' ', badge('Saw the correction', 'info')] : null);
}

export function precheckPanel(p: Precheck, finalBody: string): HTMLElement {
  const count = (s: PrecheckError['status']) => p.errors.filter((e) => e.status === s).length;
  const fixed = count('fixed');
  const dismissed = count('dismissed');
  const open = count('open');
  const revealed = p.errors.filter((e) => e.revealed).length;
  const summary =
    p.checks === 0
      ? 'not checked'
      : `${p.checks} check${p.checks === 1 ? '' : 's'}, ${p.errors.length} error${
          p.errors.length === 1 ? '' : 's'
        } marked: ${fixed} fixed, ${dismissed} marked correct by the student` +
        (open ? `, ${open} not fixed` : '') +
        (revealed ? `; correction shown for ${revealed}` : '');

  return h(
    'details',
    { class: 'card' },
    h('summary', null, h('strong', null, 'AI pre-check in the portal'), ` (${summary})`),
    h(
      'p',
      { class: 'hint' },
      'Before sending, the student checked this practice essay with the AI (vocabulary and grammar only), ' +
        'fixed each error or marked it as correct, then sent it. Hints were shown first; the correction only when the student asked.',
    ),
    p.unavailable
      ? notice(
          'warning',
          `The AI could not check the essay (${WHY[p.unavailable] ?? p.unavailable}), so the student sent it` +
            (p.checks ? ' without a final check.' : ' unchecked.'),
        )
      : null,
    p.errors.length
      ? h(
          'ol',
          { class: 'precheck-list', 'aria-label': 'Errors the AI marked' },
          ...p.errors.map((e) =>
            h(
              'li',
              null,
              h(
                'p',
                null,
                badge(e.criterion, e.criterion === 'LR' ? 'info' : ''),
                ' ',
                h('strong', null, e.type),
                h('span', { class: 'hint' }, ` · check ${e.round}`),
                ' ',
                outcome(e),
              ),
              h('p', null, h('mark', null, e.excerpt), ' → ', e.correction),
              e.hint ? h('p', { class: 'hint' }, e.hint) : null,
            ),
          ),
        )
      : p.checks
        ? h('p', null, 'The AI found no vocabulary or grammar errors.')
        : null,
    p.firstDraft
      ? h(
          'details',
          null,
          h(
            'summary',
            null,
            `First draft (before the first check${p.firstAt ? `, ${formatDateTime(p.firstAt)}` : ''})`,
          ),
          p.firstDraft === finalBody
            ? h('p', { class: 'hint' }, 'The same as the essay sent.')
            : h('p', { class: 'prompt-text' }, p.firstDraft),
        )
      : null,
  );
}
