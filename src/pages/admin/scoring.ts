// Admin scoring page: essay panel | reference panel (Claude + external tools) | score form.
import { overallBand } from '../../../shared/band';
import {
  buildClaudePrompt,
  buildReconcilePrompt,
  type ClaudeDraft,
  matchClaudeErrors,
  matchTopic,
  parseClaudeReply,
} from '../../../shared/claude';
import {
  CRITERIA,
  criterionLabel,
  type Criterion,
  CRITERION_SHORT,
} from '../../../shared/constants';
import { countWords } from '../../../shared/wordCount';
import { api, ApiClientError } from '../../api';
import { type Child, h, replace } from '../../dom';
import { onLeave, type RouteContext, setUnsavedCheck } from '../../router';
import {
  async,
  badge,
  busy,
  confirmDialog,
  errorBox,
  errorMessage,
  field,
  link,
  notice,
  page,
  selectEl,
  table,
  toast,
} from '../../ui/components';
import { copyText } from '../../ui/clipboard';
import { essayText, selectionOffsets } from '../../ui/essayText';
import { formatBand, formatDateTime, modeLabel, signed, taskLabel } from '../../ui/format';
import { remoteImage } from '../../ui/image';
import { plainText } from '../../ui/markdown';
import { tabs } from '../../ui/tabs';
import { scoreTable } from '../student/essayDetail';
import type { AdminEssayResponse, CategoryRow, SourceFeedbackView } from './types';

interface FormError {
  key: string;
  categoryId: string | null;
  unknownLabel?: string;
  excerpt: string;
  start: number | null;
  end: number | null;
  correction: string;
  note: string;
}

interface FormState {
  scores: Record<Criterion, number | null>;
  feedback: Record<Criterion, string>;
  generalComment: string;
  topicId: string;
  errors: FormError[];
  rewrite: { required: boolean; dueDate: string; note: string };
  notifyAgain: boolean;
}

const BAND_OPTIONS = Array.from({ length: 19 }, (_, i) => (i / 2).toFixed(1));

function bandSelect(name: string, value: number | null, placeholder = '–'): HTMLSelectElement {
  return selectEl(
    name,
    BAND_OPTIONS.map((b) => ({ value: b, label: b })),
    value === null || value === undefined ? '' : value.toFixed(1),
    placeholder,
  );
}

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

let keySeq = 0;
const newKey = () => `new-${++keySeq}`;

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function scoringPage(ctx: RouteContext): Node {
  return async(
    () => api<AdminEssayResponse>('admin.essay', { id: ctx.params.id }),
    (data, reload) => buildScoring(data, reload),
    'Loading essay…',
  );
}

function categoryOptions(categories: CategoryRow[], current: string | null): HTMLSelectElement {
  const sel = h('select', { name: 'categoryId' }, h('option', { value: '' }, 'Choose a category…'));
  for (const c of CRITERIA) {
    const group = h('optgroup', { label: criterionLabel(c) });
    for (const cat of categories.filter(
      (x) => x.criterion === c && (x.active || x.id === current),
    )) {
      group.appendChild(
        h(
          'option',
          { value: cat.id, selected: cat.id === current },
          cat.active ? cat.label : `${cat.label} (inactive)`,
        ),
      );
    }
    sel.appendChild(group);
  }
  return sel;
}

function buildScoring(data: AdminEssayResponse, reload: () => void): Child {
  const essay = data.essay;
  const taskType = essay.taskType;
  const activeCats = data.categories.filter((c) => c.active);
  let requestId = newRequestId();
  let dirty = false;
  let lastDraft: ClaudeDraft | null = data.claudeDraft?.parsed ?? null;
  const sourceValues = new Map<string, SourceFeedbackView>(
    data.sourceFeedback.map((s) => [s.sourceId, s]),
  );

  const defaultDue = localDate(new Date(Date.now() + 7 * 86400000));
  const rw = essay.rewrite;
  const state: FormState = {
    scores: Object.fromEntries(
      CRITERIA.map((c) => [c, essay.score?.criteria[c] ?? null]),
    ) as Record<Criterion, number | null>,
    feedback: Object.fromEntries(
      CRITERIA.map((c) => [c, essay.score?.feedback[c] ?? '']),
    ) as Record<Criterion, string>,
    generalComment: essay.score?.generalComment ?? '',
    topicId: essay.topicId,
    errors: essay.errors.map((e) => ({
      key: e.id,
      categoryId: e.categoryId,
      excerpt: e.excerpt,
      start: e.start,
      end: e.end,
      correction: e.correction,
      note: e.note,
    })),
    rewrite: {
      required: Boolean(rw && rw.status !== 'waived'),
      dueDate: rw ? localDate(new Date(rw.dueAt)) : defaultDue,
      note: rw?.note ?? '',
    },
    notifyAgain: false,
  };
  setUnsavedCheck(() => dirty);
  onLeave(() => setUnsavedCheck(null));

  // ---------- Essay panel ----------
  let activeKey = '';
  let selection: { start: number; end: number; text: string } | null = null;
  const textHolder = h('div');
  const selectionInfo = h(
    'p',
    { class: 'hint', 'aria-live': 'polite' },
    'Select text in the essay to tag an error.',
  );

  const renderText = () => {
    const el = essayText(
      essay.body,
      state.errors.map((e) => ({
        id: e.key,
        start: e.start,
        end: e.end,
        label:
          data.categories.find((c) => c.id === e.categoryId)?.label ??
          e.unknownLabel ??
          'Uncategorised',
        correction: e.correction,
        active: e.key === activeKey,
      })),
      (id) => {
        activeKey = id;
        renderText();
        document
          .getElementById(`row-${id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
    );
    const track = () => {
      const off = selectionOffsets(el);
      selection = off ? { ...off, text: essay.body.slice(off.start, off.end) } : null;
      selectionInfo.textContent = selection
        ? `Selected: “${selection.text.slice(0, 120)}” (characters ${selection.start}–${selection.end})`
        : 'Select text in the essay to tag an error.';
      addBtn.disabled = !selection;
      errorsBox
        .querySelectorAll<HTMLButtonElement>('[data-place]')
        .forEach((b) => (b.disabled = !selection));
    };
    el.addEventListener('mouseup', track);
    el.addEventListener('keyup', track);
    el.addEventListener('touchend', track);
    replace(textHolder, el);
  };

  const essayPanel = h(
    'section',
    { 'aria-labelledby': 'essay-heading' },
    h('h2', { id: 'essay-heading' }, 'Essay'),
    h(
      'p',
      { class: 'meta' },
      data.student ? `${data.student.name} (${data.student.className || 'no class'}) · ` : '',
      `${taskLabel(taskType)} · ${modeLabel(essay.mode)} · ${essay.wordCount} words`,
      data.assignment ? [' · ', badge(data.assignment.title, 'info')] : null,
      essay.parentEssayId ? [' · ', badge('Rewrite', 'info')] : null,
    ),
    h(
      'p',
      { class: 'hint' },
      `Submitted ${formatDateTime(essay.submittedAt)}`,
      essay.timeUsedSeconds !== null
        ? ` · Time used ${Math.round(essay.timeUsedSeconds / 60)} of ${essay.timeLimitMinutes} min`
        : '',
      essay.overTime ? [' ', badge('Over time', 'warning')] : null,
      essay.autoSubmitted ? [' ', badge('Auto-submitted')] : null,
      essay.mode !== 'practice'
        ? [
            ' ',
            badge(`${essay.pasteAttempts} paste attempt(s)`, essay.pasteAttempts ? 'warning' : ''),
          ]
        : null,
    ),
    driveStatusBox(data, reload),
    h('h3', null, 'Prompt'),
    h('p', { class: 'prompt-text' }, essay.prompt),
    essay.hasImage
      ? remoteImage('admin.essayImage', { essayId: essay.id }, 'Chart or diagram for this task')
      : null,
    h('h3', null, 'Essay text'),
    selectionInfo,
    textHolder,
    data.parent
      ? h(
          'details',
          { class: 'card', open: true },
          h('summary', null, h('strong', null, 'Original essay and its final score')),
          data.parent.score
            ? scoreTable(data.parent.score, taskType)
            : notice('info', 'The original has no final score.'),
          essayText(
            data.parent.body,
            data.parent.errors.map((e) => ({
              id: e.id,
              start: e.start,
              end: e.end,
              label: e.category,
              correction: e.correction,
            })),
          ),
          link(`/admin/score/${data.parent.id}`, 'Open the original'),
        )
      : null,
  );

  // ---------- Score form ----------
  const formStatus = h('div', { 'aria-live': 'polite' });
  const overallOut = h('output', { class: 'overall', 'aria-live': 'polite' });
  const updateOverall = () => {
    const vals = CRITERIA.map((c) => state.scores[c]);
    overallOut.textContent = vals.every((v) => v !== null)
      ? `Overall band ${formatBand(overallBand(vals as number[]))}`
      : 'Overall band: enter all four scores';
  };

  const scoreBox = h('div', { class: 'score-inputs' });
  const feedbackBox = h('div');
  const generalBox = h('div');
  const topicBox = h('div');
  const errorsBox = h('div');
  const rewriteBox = h('div');

  const renderScores = () => {
    replace(
      scoreBox,
      ...CRITERIA.map((c) => {
        const sel = bandSelect(`score-${c}`, state.scores[c]);
        sel.addEventListener('change', () => {
          state.scores[c] = sel.value === '' ? null : Number(sel.value);
          dirty = true;
          updateOverall();
        });
        return field({ label: criterionLabel(c, taskType), control: sel, name: `scores.${c}` });
      }),
    );
    updateOverall();
  };

  const renderFeedback = () => {
    replace(
      feedbackBox,
      ...CRITERIA.map((c) => {
        const ta = h('textarea', { name: `feedback-${c}`, rows: '4', maxlength: '10000' });
        ta.value = state.feedback[c];
        ta.addEventListener('input', () => {
          state.feedback[c] = ta.value;
          dirty = true;
        });
        return field({
          label: `Feedback: ${criterionLabel(c, taskType)} (Markdown)`,
          control: ta,
          name: `feedback.${c}`,
        });
      }),
    );
    const general = h('textarea', { name: 'generalComment', rows: '3', maxlength: '10000' });
    general.value = state.generalComment;
    general.addEventListener('input', () => {
      state.generalComment = general.value;
      dirty = true;
    });
    replace(
      generalBox,
      field({ label: 'General comment (Markdown)', control: general, name: 'generalComment' }),
    );
  };

  const renderTopic = () => {
    const sel = selectEl(
      'topicId',
      data.topics
        .filter((t) => t.active || t.id === state.topicId)
        .map((t) => ({ value: t.id, label: t.label })),
      state.topicId,
    );
    sel.addEventListener('change', () => {
      state.topicId = sel.value;
      dirty = true;
    });
    replace(
      topicBox,
      field({
        label: 'Topic',
        control: sel,
        name: 'topicId',
        hint: 'Changing the topic renames the Drive folder.',
      }),
    );
  };

  // Error tagger: add from selection.
  const newCat = categoryOptions(data.categories, null);
  const newCorrection = h('input', { name: 'newCorrection', maxlength: '1000' });
  const newNote = h('input', { name: 'newNote', maxlength: '1000' });
  const addBtn = h('button', { type: 'button', class: 'btn', disabled: true }, 'Tag selected text');
  addBtn.addEventListener('click', () => {
    if (!selection) return;
    if (!newCat.value) {
      newCat.focus();
      toast('Choose a category for the error.', 'error');
      return;
    }
    state.errors.push({
      key: newKey(),
      categoryId: newCat.value,
      excerpt: selection.text,
      start: selection.start,
      end: selection.end,
      correction: newCorrection.value,
      note: newNote.value,
    });
    newCorrection.value = '';
    newNote.value = '';
    selection = null;
    window.getSelection()?.removeAllRanges();
    dirty = true;
    renderErrors();
    renderText();
    addBtn.disabled = true;
    selectionInfo.textContent = 'Error added. Select more text to tag another.';
  });
  const tagger = h(
    'fieldset',
    { class: 'card' },
    h('legend', null, 'Error tagger'),
    h(
      'p',
      { class: 'hint' },
      'Select text in the essay, choose a category, type the correction and press “Tag selected text”.',
    ),
    h(
      'div',
      { class: 'grid-2' },
      field({ label: 'Category', control: newCat }),
      field({ label: 'Correction', control: newCorrection }),
    ),
    field({ label: 'Note (optional)', control: newNote }),
    addBtn,
  );

  const renderErrors = () => {
    const sorted = [...state.errors].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
    if (sorted.length === 0) {
      replace(errorsBox, h('p', { class: 'hint' }, 'No errors tagged yet.'));
      return;
    }
    replace(
      errorsBox,
      h(
        'ol',
        { class: 'error-list' },
        ...sorted.map((e) => {
          const cat = categoryOptions(data.categories, e.categoryId);
          cat.setAttribute('aria-label', 'Category');
          cat.addEventListener('change', () => {
            e.categoryId = cat.value || null;
            dirty = true;
            renderErrors();
            renderText();
          });
          const corr = h('input', {
            value: e.correction,
            'aria-label': 'Correction',
            maxlength: '1000',
          });
          corr.addEventListener('input', () => {
            e.correction = corr.value;
            dirty = true;
          });
          const note = h('input', {
            value: e.note,
            'aria-label': 'Note',
            placeholder: 'Note (optional)',
            maxlength: '1000',
          });
          note.addEventListener('input', () => {
            e.note = note.value;
            dirty = true;
          });
          const place = h(
            'button',
            { type: 'button', class: 'btn btn-small', 'data-place': '', disabled: !selection },
            'Place at selection',
          );
          place.addEventListener('click', () => {
            if (!selection) return;
            e.start = selection.start;
            e.end = selection.end;
            e.excerpt = selection.text;
            dirty = true;
            renderErrors();
            renderText();
          });
          const del = h(
            'button',
            { type: 'button', class: 'btn btn-small btn-danger-outline' },
            'Delete',
          );
          del.addEventListener('click', () => {
            state.errors = state.errors.filter((x) => x !== e);
            dirty = true;
            renderErrors();
            renderText();
          });
          const unplaced = e.start === null || e.end === null;
          const unknown = !e.categoryId;
          return h(
            'li',
            { id: `row-${e.key}`, class: unplaced || unknown ? 'flagged' : '' },
            h(
              'div',
              null,
              h('span', { class: 'excerpt' }, `“${e.excerpt}”`),
              ' ',
              unplaced ? badge('Unplaced', 'warning') : null,
            ),
            unknown && e.unknownLabel
              ? h(
                  'p',
                  { class: 'field-error' },
                  `Claude used “${e.unknownLabel}”, which is not an active category. Choose one.`,
                )
              : null,
            unplaced
              ? h(
                  'p',
                  { class: 'hint' },
                  'Not found exactly in the essay. Select the right text and press “Place at selection”, or delete it.',
                )
              : null,
            cat,
            corr,
            note,
            h('div', { class: 'actions' }, place, del),
          );
        }),
      ),
    );
  };

  const renderRewrite = () => {
    const required = h('input', {
      type: 'checkbox',
      id: 'rw-required',
      checked: state.rewrite.required,
    });
    const due = h('input', {
      type: 'date',
      name: 'rewrite.dueDate',
      value: state.rewrite.dueDate,
      min: localDate(new Date()),
    });
    const note = h('textarea', { name: 'rewrite.note', rows: '2', maxlength: '1000' });
    note.value = state.rewrite.note;
    const sync = () => {
      due.disabled = !required.checked;
      note.disabled = !required.checked;
    };
    required.addEventListener('change', () => {
      state.rewrite.required = required.checked;
      dirty = true;
      sync();
    });
    due.addEventListener('change', () => {
      state.rewrite.dueDate = due.value;
      dirty = true;
    });
    note.addEventListener('input', () => {
      state.rewrite.note = note.value;
      dirty = true;
    });
    sync();
    replace(
      rewriteBox,
      h(
        'fieldset',
        { class: 'card' },
        h('legend', null, 'Rewrite request'),
        h(
          'div',
          { class: 'field checkbox' },
          required,
          h('label', { for: 'rw-required' }, 'Rewrite required'),
        ),
        field({
          label: 'Due date (end of day, student’s time zone)',
          control: due,
          name: 'rewrite.dueDate',
        }),
        field({ label: 'Instructions for the student', control: note, name: 'rewrite.note' }),
        rw && rw.status !== 'waived'
          ? h(
              'p',
              { class: 'hint' },
              `Current request: ${rw.status}${rw.late ? ' (late)' : ''}. Untick to waive it.`,
            )
          : null,
      ),
    );
  };

  const sampleBox = h('input', { type: 'checkbox', id: 'is-sample', checked: data.isSample });
  sampleBox.addEventListener('change', async () => {
    try {
      await api('admin.setSample', { essayId: essay.id, sample: sampleBox.checked });
      toast(
        sampleBox.checked ? 'Marked as a calibration sample.' : 'Removed from calibration samples.',
      );
    } catch (err) {
      sampleBox.checked = !sampleBox.checked;
      toast(errorMessage(err), 'error');
    }
  });
  const notifyBox = h('input', { type: 'checkbox', id: 'notify-again' });
  notifyBox.addEventListener('change', () => (state.notifyAgain = notifyBox.checked));

  const reconcileView = h('div');
  const showReconcile = (text: string | null, at?: string) => {
    replace(
      reconcileView,
      text
        ? h(
            'div',
            { class: 'card' },
            h('h3', null, 'Reconcile notes'),
            at ? h('p', { class: 'hint' }, `Saved ${formatDateTime(at)}`) : null,
            plainText(text),
          )
        : null,
    );
  };
  showReconcile(data.reconcile?.rawText ?? null, data.reconcile?.createdAt);

  // Copy for Claude / Paste Claude draft
  const claudePromptText = () =>
    buildClaudePrompt({
      taskType,
      prompt: essay.prompt,
      topic: data.topics.find((t) => t.id === state.topicId)?.label ?? essay.topic,
      wordCount: countWords(essay.body),
      body: essay.body,
      recurringErrors: data.recurringErrors,
    });
  const copyBtn = h('button', { type: 'button', class: 'btn' }, 'Copy for Claude');
  copyBtn.addEventListener('click', async () => {
    try {
      await copyText(claudePromptText());
      toast(
        taskType === 'task1_academic'
          ? 'Copied. Paste it into your Claude Project and attach the chart image.'
          : 'Copied. Paste it into your Claude Project.',
      );
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  });
  const pasteBtn = h('button', { type: 'button', class: 'btn' }, 'Paste Claude draft');

  const validate = (forSubmit: boolean): string[] => {
    const problems: string[] = [];
    if (forSubmit && CRITERIA.some((c) => state.scores[c] === null))
      problems.push('Enter all four criterion scores.');
    if (state.errors.some((e) => !e.categoryId))
      problems.push('Choose a category for every flagged error.');
    if (forSubmit && state.errors.some((e) => e.start === null))
      problems.push('Place or delete every unplaced error.');
    if (state.rewrite.required && !state.rewrite.dueDate)
      problems.push('Choose a rewrite due date.');
    return problems;
  };

  const payload = (submit: boolean) => ({
    essayId: essay.id,
    scores: state.scores,
    feedback: state.feedback,
    generalComment: state.generalComment,
    topicId: state.topicId,
    errors: state.errors.map((e) => ({
      categoryId: e.categoryId,
      excerpt: e.excerpt,
      start: e.start,
      end: e.end,
      correction: e.correction,
      note: e.note,
    })),
    rewrite: state.rewrite,
    submit,
    notifyAgain: state.notifyAgain,
    requestId,
  });

  const saveBtn = h('button', { type: 'button', class: 'btn' }, 'Save draft');
  const submitBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Submit score');

  const showOutcome = (res: { email: string; driveRenamed?: boolean }) => {
    const messages: Record<string, Child> = {
      sent: notice('success', 'Score submitted and the result email was sent.'),
      queued: notice(
        'warning',
        'Score submitted. Email queued until tomorrow: the Gmail daily quota is used up. It will be sent automatically.',
      ),
      failed: notice(
        'error',
        'Score submitted, but the email failed to send. Use “Resend email” below or on the Email page.',
      ),
      duplicate: notice(
        'info',
        'Score saved. The email had already been sent, so it was not sent again.',
      ),
      none: notice(
        'success',
        'Score saved. No email was sent (tick “Notify student again” to re-send).',
      ),
      draft: notice('success', 'Draft saved. Nothing has been sent to the student.'),
    };
    replace(formStatus, messages[res.email] ?? notice('success', 'Saved.'));
  };

  saveBtn.addEventListener('click', () => {
    const problems = validate(false);
    if (problems.length)
      return replace(formStatus, notice('error', ...problems.map((p) => h('p', null, p))));
    void busy(saveBtn, 'Saving…', async () => {
      try {
        const res = await api<{ email: string }>('admin.saveScore', payload(false));
        dirty = false;
        showOutcome(res);
      } catch (err) {
        replace(formStatus, errorBox(err), apiFieldList(err));
      }
    });
  });

  submitBtn.addEventListener('click', async () => {
    const problems = validate(true);
    if (problems.length)
      return replace(formStatus, notice('error', ...problems.map((p) => h('p', null, p))));
    const already = essay.status === 'scored';
    const ok = await confirmDialog({
      title: already ? 'Update the final score?' : 'Submit the final score?',
      message: already
        ? state.notifyAgain
          ? 'The student will see the new score and receive the result email again.'
          : 'The student will see the new score. No email will be sent.'
        : 'The essay is locked as scored and the student receives the result email.',
      confirmLabel: already ? 'Update score' : 'Submit score',
    });
    if (!ok) return;
    await busy(submitBtn, 'Submitting…', async () => {
      try {
        const res = await api<{ email: string }>('admin.saveScore', payload(true));
        dirty = false;
        requestId = newRequestId();
        showOutcome(res);
        setTimeout(reload, 1500);
      } catch (err) {
        replace(formStatus, errorBox(err), apiFieldList(err));
      }
    });
  });

  const renderAll = () => {
    renderScores();
    renderFeedback();
    renderTopic();
    renderErrors();
    renderRewrite();
    renderText();
  };

  const formPanel = h(
    'section',
    { 'aria-labelledby': 'form-heading' },
    h('h2', { id: 'form-heading' }, 'Score'),
    reconcileView,
    h('div', { class: 'actions' }, copyBtn, pasteBtn),
    scoreBox,
    h('p', null, overallOut),
    topicBox,
    tagger,
    h('h3', null, 'Tagged errors'),
    errorsBox,
    generalBox,
    feedbackBox,
    rewriteBox,
    h(
      'div',
      { class: 'field checkbox' },
      sampleBox,
      h(
        'label',
        { for: 'is-sample' },
        'Use as calibration sample (exported to the Claude Project)',
      ),
    ),
    essay.status === 'scored'
      ? h(
          'div',
          { class: 'field checkbox' },
          notifyBox,
          h('label', { for: 'notify-again' }, 'Notify student again (re-send the result email)'),
        )
      : null,
    h('div', { class: 'actions sticky-actions' }, saveBtn, submitBtn),
    formStatus,
    emailEventsBox(data, reload),
  );

  // ---------- Reference panel ----------
  const claudePanel = buildClaudePanel({
    data,
    claudePromptText,
    onParsed: (draft) => {
      lastDraft = draft;
    },
    onLoad: async (draft) => {
      if (state.errors.length || CRITERIA.some((c) => state.scores[c] !== null)) {
        const ok = await confirmDialog({
          title: 'Replace the form with Claude’s draft?',
          message:
            'Scores, feedback and tagged errors in the form will be replaced. Nothing is sent to the student.',
          confirmLabel: 'Load into form',
        });
        if (!ok) return;
      }
      const matched = matchClaudeErrors(
        draft.errors,
        activeCats.map((c) => ({ id: c.id, label: c.label })),
        essay.body,
      );
      state.scores = { ...draft.scores };
      state.feedback = { ...draft.feedback };
      state.generalComment = draft.generalComment;
      const topic = matchTopic(
        draft.suggestedTopic,
        data.topics.filter((t) => t.active),
      );
      if (topic) state.topicId = topic;
      state.errors = matched.map((m) => ({
        key: newKey(),
        categoryId: m.categoryId,
        unknownLabel: m.unknownCategory ? m.category : undefined,
        excerpt: m.excerpt,
        start: m.start,
        end: m.end,
        correction: m.correction,
        note: m.note,
      }));
      dirty = true;
      renderAll();
      const flagged = matched.filter((m) => m.unknownCategory).length;
      const unplaced = matched.filter((m) => m.unplaced).length;
      replace(
        formStatus,
        notice(
          flagged || unplaced ? 'warning' : 'success',
          h(
            'p',
            null,
            'Claude’s draft is loaded into the form. Review and edit before submitting.',
          ),
          flagged ? h('p', null, `${flagged} error(s) use an unknown category: choose one.`) : null,
          unplaced
            ? h('p', null, `${unplaced} excerpt(s) were not found exactly: place or delete them.`)
            : null,
          draft.suggestedTopic && !topic
            ? h(
                'p',
                null,
                `Claude suggested the topic “${draft.suggestedTopic}”, which is not in the list.`,
              )
            : null,
        ),
      );
      document.getElementById('form-heading')?.scrollIntoView({ behavior: 'smooth' });
    },
    onReconcileCopy: async () => {
      const sources = data.sources
        .filter((s) => s.name !== 'Claude' && sourceValues.has(s.id))
        .map((s) => {
          const v = sourceValues.get(s.id)!;
          const cal = data.calibration.find((c) => c.sourceId === s.id);
          return {
            name: s.name,
            scores: v.scores,
            overall: v.overall,
            feedback: v.feedbackText,
            bias: cal?.bias ?? {},
            samples: cal?.samples ?? 0,
          };
        });
      try {
        await copyText(buildReconcilePrompt({ taskType, claudeDraft: lastDraft, sources }));
        toast('Reconcile prompt copied. Paste it into the same Claude chat.');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    },
    onReconcileSaved: (text, at) => showReconcile(text, at),
  });

  const sourceTabs = data.sources
    .filter((s) => s.name !== 'Claude' && (s.active || sourceValues.has(s.id)))
    .map((s) => ({
      id: s.id,
      label: s.name,
      panel: sourcePanel(data, s, sourceValues),
    }));
  const reference = tabs(
    [{ id: 'claude', label: 'Claude draft', panel: claudePanel.element }, ...sourceTabs],
    'Reference material',
  );
  pasteBtn.addEventListener('click', () => {
    reference.select('claude');
    claudePanel.focusPaste();
  });

  const referencePanel = h(
    'section',
    { 'aria-labelledby': 'ref-heading' },
    h('h2', { id: 'ref-heading' }, 'Reference (admin only)'),
    reference.element,
  );

  renderAll();
  return page(
    `Score: ${data.student?.name ?? 'Student'} – ${essay.topic}`,
    h('p', null, link('/admin', '← Back to the queue')),
    h('div', { class: 'scoring-layout' }, essayPanel, referencePanel, formPanel),
  );
}

function apiFieldList(err: unknown): Child {
  if (!(err instanceof ApiClientError) || !Object.keys(err.fields).length) return null;
  return h(
    'ul',
    { class: 'field-error' },
    ...Object.entries(err.fields).map(([k, v]) => h('li', null, `${k}: ${v}`)),
  );
}

function driveStatusBox(data: AdminEssayResponse, reload: () => void): Child {
  const status = data.essay.driveStatus;
  if (status === 'ok') return h('p', { class: 'hint' }, 'Copied to Google Drive.');
  if (status === 'failed' || status === 'pending' || status === '') {
    const btn = h('button', { type: 'button', class: 'btn btn-small' }, 'Retry Drive copy');
    const out = h('span', { 'aria-live': 'polite' });
    btn.addEventListener('click', () =>
      busy(btn, 'Saving to Drive…', async () => {
        try {
          const res = await api<{ driveStatus: string }>('admin.retryDrive', {
            essayId: data.essay.id,
          });
          toast(
            res.driveStatus === 'ok' ? 'Copied to Drive.' : 'Drive copy failed again.',
            res.driveStatus === 'ok' ? 'info' : 'error',
          );
          reload();
        } catch (err) {
          replace(out, errorBox(err));
        }
      }),
    );
    return notice(
      status === 'failed' ? 'error' : 'warning',
      status === 'failed' ? 'Drive copy failed. ' : 'Not yet copied to Drive. ',
      btn,
      out,
    );
  }
  return null;
}

function emailEventsBox(data: AdminEssayResponse, reload: () => void): Child {
  const events = data.emailEvents;
  if (!events.length) return null;
  const lastByKey = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    const prev = lastByKey.get(e.key);
    if (!prev || prev.status !== 'sent') lastByKey.set(e.key, e);
  }
  const needsRetry = [...lastByKey.values()].filter((e) => e.status === 'failed');
  const btn = needsRetry.length
    ? h('button', { type: 'button', class: 'btn btn-small' }, 'Resend email')
    : null;
  const out = h('div', { 'aria-live': 'polite' });
  btn?.addEventListener('click', () =>
    busy(btn, 'Sending…', async () => {
      try {
        const res = await api<{ outcomes: Record<string, number> }>('admin.resendEmail', {
          essayId: data.essay.id,
        });
        toast(
          `Email: ${
            Object.entries(res.outcomes)
              .map(([k, v]) => `${v} ${k}`)
              .join(', ') || 'nothing to resend'
          }.`,
        );
        reload();
      } catch (err) {
        replace(out, errorBox(err));
      }
    }),
  );
  return h(
    'div',
    { class: 'card' },
    h('h3', null, 'Emails for this essay'),
    table(
      ['Type', 'Status', 'When'],
      events.map((e) => [
        e.type,
        [
          badge(
            e.status,
            e.status === 'sent' ? 'success' : e.status === 'failed' ? 'danger' : 'warning',
          ),
          e.error ? h('div', { class: 'hint' }, e.error) : null,
        ],
        formatDateTime(e.createdAt),
      ]),
    ),
    btn,
    out,
  );
}

function biasLine(data: AdminEssayResponse, sourceId: string, name: string): Child {
  const cal = data.calibration.find((c) => c.sourceId === sourceId);
  if (!cal || cal.samples === 0) return h('p', { class: 'hint' }, `${name}: no bias recorded yet.`);
  const parts = CRITERIA.map(
    (c) => `${CRITERION_SHORT[c]} ${cal.bias[c] === null ? 'n/a' : signed(cal.bias[c]!)}`,
  );
  return h(
    'p',
    { class: 'hint' },
    h(
      'strong',
      null,
      `${name}: ${cal.bias.overall === null ? 'n/a' : signed(cal.bias.overall)} overall`,
    ),
    ` (${cal.samples} essays · ${parts.join(' · ')} · within 0.5 band ${cal.within.overall === null ? 'n/a' : `${Math.round(cal.within.overall * 100)}%`})`,
  );
}

function sourcePanel(
  data: AdminEssayResponse,
  source: { id: string; name: string },
  values: Map<string, SourceFeedbackView>,
): HTMLElement {
  const existing = values.get(source.id);
  const selects = Object.fromEntries(
    CRITERIA.map((c) => [
      c,
      bandSelect(`${source.id}-${c}`, existing?.scores[c] ?? null, 'Not given'),
    ]),
  ) as Record<Criterion, HTMLSelectElement>;
  const overall = bandSelect(`${source.id}-overall`, existing?.overall ?? null, 'Not given');
  const text = h('textarea', { rows: '8', maxlength: '60000' });
  text.value = existing?.feedbackText ?? '';
  const status = h('div', { 'aria-live': 'polite' });
  const save = h(
    'button',
    { type: 'button', class: 'btn btn-primary' },
    `Save ${source.name} result`,
  );
  save.addEventListener('click', () =>
    busy(save, 'Saving…', async () => {
      try {
        const saved = await api<SourceFeedbackView>('admin.saveSourceFeedback', {
          essayId: data.essay.id,
          sourceId: source.id,
          scores: Object.fromEntries(
            CRITERIA.map((c) => [c, selects[c].value === '' ? null : Number(selects[c].value)]),
          ),
          overall: overall.value === '' ? null : Number(overall.value),
          feedbackText: text.value,
        });
        values.set(source.id, saved);
        replace(
          status,
          notice(
            'success',
            `${source.name} result saved ${formatDateTime(saved.createdAt)}. Reference only — never shown to the student.`,
          ),
        );
      } catch (err) {
        replace(status, errorBox(err));
      }
    }),
  );
  const isPerplexity = /perplexity/i.test(source.name);
  return h(
    'div',
    null,
    biasLine(data, source.id, source.name),
    isPerplexity
      ? h(
          'p',
          { class: 'hint' },
          'Paste the argument check here. It feeds the Task Response / Task Achievement review in the reconcile prompt.',
        )
      : null,
    h(
      'div',
      { class: 'score-inputs' },
      ...CRITERIA.map((c) =>
        field({ label: criterionLabel(c, data.essay.taskType), control: selects[c] }),
      ),
    ),
    field({ label: 'Overall (optional)', control: overall }),
    field({ label: `${source.name} feedback (pasted as plain text)`, control: text }),
    save,
    status,
  );
}

function buildClaudePanel(opts: {
  data: AdminEssayResponse;
  claudePromptText: () => string;
  onParsed: (draft: ClaudeDraft) => void;
  onLoad: (draft: ClaudeDraft) => void;
  onReconcileCopy: () => void;
  onReconcileSaved: (text: string, at: string) => void;
}) {
  const { data } = opts;
  const essay = data.essay;
  const reply = h('textarea', {
    rows: '10',
    'aria-label': 'Claude reply',
    placeholder: 'Paste Claude’s JSON reply here',
    maxlength: '60000',
  });
  const result = h('div', { 'aria-live': 'polite' });
  const check = h('button', { type: 'button', class: 'btn btn-primary' }, 'Check reply');
  const preview = h('pre', { class: 'plain-text card' });

  const showParsed = (draft: ClaudeDraft, savedAt?: string) => {
    const unknown = matchClaudeErrors(
      draft.errors,
      data.categories.filter((c) => c.active).map((c) => ({ id: c.id, label: c.label })),
      essay.body,
    );
    const load = h('button', { type: 'button', class: 'btn btn-primary' }, 'Load into form');
    load.addEventListener('click', () => opts.onLoad(draft));
    replace(
      result,
      notice(
        'success',
        h(
          'p',
          null,
          `Valid reply${savedAt ? `, saved ${formatDateTime(savedAt)}` : ''}. Overall band recalculated by the app: `,
          h('strong', null, formatBand(draft.overall)),
          '.',
        ),
        h(
          'p',
          null,
          CRITERIA.map((c) => `${CRITERION_SHORT[c]} ${formatBand(draft.scores[c])}`).join(' · '),
        ),
        h(
          'p',
          null,
          `${draft.errors.length} error(s): ${unknown.filter((u) => u.unknownCategory).length} with unknown category, ${unknown.filter((u) => u.unplaced).length} unplaced.`,
        ),
      ),
      load,
    );
  };

  check.addEventListener('click', () => {
    const parsed = parseClaudeReply(reply.value);
    if (!parsed.ok) {
      replace(
        result,
        notice(
          'error',
          h('p', null, h('strong', null, 'The reply is not valid. Nothing was loaded.')),
          h('ul', null, ...parsed.errors.map((e) => h('li', null, e))),
        ),
      );
      return;
    }
    opts.onParsed(parsed.value);
    void busy(check, 'Saving…', async () => {
      try {
        const saved = await api<{ createdAt: string }>('admin.saveClaudeDraft', {
          essayId: essay.id,
          rawText: reply.value,
        });
        showParsed(parsed.value, saved.createdAt);
      } catch (err) {
        replace(result, errorBox(err));
      }
    });
  });

  if (data.claudeDraft?.parsed) {
    reply.value = data.claudeDraft.rawText;
    showParsed(data.claudeDraft.parsed, data.claudeDraft.createdAt);
  }

  const showPreview = h(
    'details',
    null,
    h('summary', null, 'Show the text that will be copied'),
    preview,
  );
  showPreview.addEventListener('toggle', () => {
    preview.textContent = opts.claudePromptText();
  });

  const reconcileText = h('textarea', {
    rows: '6',
    'aria-label': 'Reconcile notes',
    maxlength: '60000',
  });
  reconcileText.value = data.reconcile?.rawText ?? '';
  const reconcileStatus = h('div', { 'aria-live': 'polite' });
  const copyReconcile = h('button', { type: 'button', class: 'btn' }, 'Copy reconcile prompt');
  copyReconcile.addEventListener('click', () => opts.onReconcileCopy());
  const saveReconcile = h('button', { type: 'button', class: 'btn' }, 'Save reconcile notes');
  saveReconcile.addEventListener('click', () =>
    busy(saveReconcile, 'Saving…', async () => {
      try {
        const res = await api<{ createdAt: string }>('admin.saveReconcile', {
          essayId: essay.id,
          rawText: reconcileText.value,
        });
        opts.onReconcileSaved(reconcileText.value, res.createdAt);
        replace(
          reconcileStatus,
          notice('success', 'Reconcile notes saved. They never change the form automatically.'),
        );
      } catch (err) {
        replace(reconcileStatus, errorBox(err));
      }
    }),
  );

  const element = h(
    'div',
    null,
    h('h3', null, '1. Copy for Claude'),
    h(
      'p',
      { class: 'hint' },
      'Copies the task, prompt, topic, word count, the essay (as data) and the student’s recurring errors.',
    ),
    showPreview,
    essay.taskType === 'task1_academic'
      ? notice(
          'warning',
          'Task 1 Academic: download the chart image (under the prompt) and attach it in the Claude chat.',
        )
      : null,
    h('h3', null, '2. Paste Claude draft'),
    reply,
    h('div', { class: 'actions' }, check),
    result,
    h('h3', null, '3. Reconcile with other tools'),
    h(
      'p',
      { class: 'hint' },
      'After pasting the other tools’ results in their tabs, copy this prompt into the same Claude chat and paste the answer below.',
    ),
    copyReconcile,
    field({ label: 'Reconcile notes (Claude’s answer, plain text)', control: reconcileText }),
    saveReconcile,
    reconcileStatus,
  );
  return { element, focusPaste: () => reply.focus() };
}
