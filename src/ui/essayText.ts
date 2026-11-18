// Essay text with highlighted errors. Text is inserted as text nodes, and the
// rendered characters match the stored body exactly, so selections map to
// character offsets.
import { CRITERIA, CRITERION_SHORT, type Criterion } from '../../shared/constants';
import { inlineLayout } from '../../shared/inlineLayout';
import { h } from '../dom';

export interface Highlight {
  id: string;
  start: number | null;
  end: number | null;
  label: string;
  correction: string;
  /** Explanation for the student (Vietnamese), shown in the tooltip. */
  note?: string;
  active?: boolean;
  /** Colours the highlight: red TA/TR, orange CC, blue LR, purple GRA. */
  criterion?: Criterion | null;
}

/** Colour key shown above highlighted essays (colour is never the only cue: each mark names its category). */
export function highlightLegend(): HTMLElement {
  return h(
    'p',
    { class: 'highlight-legend' },
    'Highlight colours: ',
    ...CRITERIA.map((c) =>
      h(
        'span',
        { class: `legend-item err-${c}` },
        h('span', { class: `swatch swatch-${c}`, 'aria-hidden': 'true' }),
        CRITERION_SHORT[c],
      ),
    ),
  );
}

export interface EssayTextOptions {
  /**
   * Show the essay as corrected by the teacher: the wrong words are struck through and the
   * correction follows them. The rendered text then no longer matches the stored body, so this is
   * only for reading (what the student sees), never for selecting text.
   */
  inlineCorrections?: boolean;
}

interface TipEntry {
  label: string;
  criterion: Criterion | null;
  note: string;
  correction: string;
}

function tipOf(x: Highlight): TipEntry {
  return {
    label: x.label,
    criterion: x.criterion ?? null,
    note: (x.note ?? '').trim(),
    correction: x.correction.trim(),
  };
}

function describe(tips: TipEntry[]): string {
  return tips
    .map((t) =>
      [t.label, t.note, t.correction ? `Correction: ${t.correction}` : '']
        .filter(Boolean)
        .join(' — '),
    )
    .join('; ');
}

// One floating tooltip for every highlight on the page. It appears at once on hover, on keyboard
// focus and on a tap, which the browser's own title tooltip does not do reliably.
let tooltip: HTMLElement | null = null;
let tipsReady = false;

// The tooltip is a popover so that it also shows above the preview dialog (top layer).
function setTipVisible(visible: boolean) {
  if (!tooltip) return;
  if (typeof tooltip.showPopover === 'function') {
    const open = tooltip.matches(':popover-open');
    if (visible && !open) tooltip.showPopover();
    else if (!visible && open) tooltip.hidePopover();
  } else {
    tooltip.hidden = !visible;
  }
}

function hideTip() {
  setTipVisible(false);
}

function showTip(mark: HTMLElement) {
  let tips: TipEntry[];
  try {
    tips = JSON.parse(mark.dataset.tip ?? '[]') as TipEntry[];
  } catch {
    return;
  }
  if (tips.length === 0) return;
  if (!tooltip) {
    tooltip = h('div', { class: 'err-tooltip', role: 'tooltip', popover: 'manual' });
    document.body.appendChild(tooltip);
  }
  tooltip.replaceChildren(
    ...tips.map((t) =>
      h(
        'div',
        { class: `err-tip-item${t.criterion ? ` err-tip-${t.criterion}` : ''}` },
        h(
          'div',
          { class: 'err-tip-head' },
          h('strong', null, t.label),
          t.criterion ? ` · ${CRITERION_SHORT[t.criterion]}` : '',
        ),
        t.note ? h('div', { class: 'err-tip-note' }, t.note) : null,
        t.correction
          ? h('div', { class: 'err-tip-fix' }, 'Correction: ', h('strong', null, t.correction))
          : null,
      ),
    ),
  );
  setTipVisible(true);
  const r = mark.getBoundingClientRect();
  const w = tooltip.offsetWidth;
  const hgt = tooltip.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const below = r.bottom + 6;
  const top = below + hgt > window.innerHeight - 8 && r.top - hgt - 6 > 8 ? r.top - hgt - 6 : below;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function setupTips() {
  if (tipsReady) return;
  tipsReady = true;
  const markOf = (t: EventTarget | null) =>
    t instanceof Element ? t.closest<HTMLElement>('mark.err[data-tip]') : null;
  document.addEventListener('mouseover', (e) => {
    const m = markOf(e.target);
    if (m) showTip(m);
    else hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const m = markOf(e.target);
    if (m) showTip(m);
    else hideTip();
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTip();
  });
}

export function essayText(
  body: string,
  highlights: Highlight[],
  onSelectHighlight?: (id: string) => void,
  options: EssayTextOptions = {},
): HTMLElement {
  setupTips();
  const container = h('div', { class: 'essay-text', dataset: { essayText: '' } });
  if (options.inlineCorrections) {
    container.classList.add('essay-corrected');
    const byId = new Map(highlights.map((x) => [x.id, x]));
    for (const piece of inlineLayout(body, highlights)) {
      if (piece.kind === 'text') {
        container.appendChild(document.createTextNode(piece.text));
        continue;
      }
      const covered = piece.ids.map((id) => byId.get(id)!).filter(Boolean);
      const first = covered[0];
      const tips = covered.map(tipOf);
      const description = describe(tips);
      const mark = h(
        'mark',
        {
          class: `err${first.criterion ? ` err-${first.criterion}` : ''}${covered.some((x) => x.active) ? ' active' : ''}`,
          tabindex: '0',
          'aria-label': piece.struck
            ? `${piece.original} should be ${piece.replacement || '(deleted)'}. ${description}`
            : `${piece.original} (error — ${description})`,
          dataset: { ids: piece.ids.join(' '), tip: JSON.stringify(tips) },
        },
        piece.struck ? h('del', null, piece.original) : piece.original,
        piece.struck && piece.replacement ? h('ins', null, piece.replacement) : null,
      );
      if (onSelectHighlight) {
        const pick = () => onSelectHighlight(piece.id);
        mark.addEventListener('click', pick);
        mark.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        });
      }
      container.appendChild(mark);
    }
    return container;
  }
  const placed = highlights.filter(
    (x) =>
      x.start !== null && x.end !== null && x.start >= 0 && x.end <= body.length && x.end > x.start,
  );
  const bounds = new Set<number>([0, body.length]);
  for (const x of placed) {
    bounds.add(x.start!);
    bounds.add(x.end!);
  }
  const points = [...bounds].sort((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const text = body.slice(from, to);
    const covering = placed.filter((x) => x.start! <= from && x.end! >= to);
    if (covering.length === 0) {
      container.appendChild(document.createTextNode(text));
      continue;
    }
    const tips = covering.map(tipOf);
    const description = describe(tips);
    const mark = h(
      'mark',
      {
        class: `err${covering[0].criterion ? ` err-${covering[0].criterion}` : ''}${covering.some((x) => x.active) ? ' active' : ''}`,
        tabindex: onSelectHighlight ? '0' : null,
        'aria-label': `${text} (error — ${description})`,
        dataset: { ids: covering.map((x) => x.id).join(' '), tip: JSON.stringify(tips) },
      },
      text,
    );
    if (onSelectHighlight) {
      const pick = () => onSelectHighlight(covering[0].id);
      mark.addEventListener('click', pick);
      mark.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
    }
    container.appendChild(mark);
  }
  return container;
}

/** Character offsets of the current selection inside an essayText container. */
export function selectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }
  const offsetOf = (node: Node, offset: number): number => {
    const pre = document.createRange();
    pre.selectNodeContents(container);
    pre.setEnd(node, offset);
    return pre.toString().length;
  };
  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  return start < end ? { start, end } : null;
}
