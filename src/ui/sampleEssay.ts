// The teacher's sample essay for a student: the text, its band and why it is better.
import { CRITERIA, criterionLabel, type TaskType } from '../../shared/constants';
import { h } from '../dom';
import type { SampleView } from '../types';
import { formatBand } from './format';
import { markdown } from './markdown';

/** Heading level 2 on the essay page, 3 inside the result preview. */
export function sampleSection(
  sample: SampleView | null | undefined,
  taskType: TaskType,
  level: 2 | 3 = 2,
): HTMLElement | null {
  if (!sample?.text.trim()) return null;
  const heading = level === 2 ? 'h2' : 'h3';
  const sub = level === 2 ? 'h3' : 'h4';
  const reasons = CRITERIA.filter((c) => sample.analysis[c]?.trim());
  return h(
    'section',
    { class: 'sample-section', 'aria-label': 'Sample essay' },
    h(heading, null, `Sample essay · Band ${formatBand(sample.band)}`),
    h(
      'p',
      { class: 'hint' },
      'Your teacher wrote this sample to show how your essay could be improved. Compare it with your own essay.',
    ),
    h('div', { class: 'card sample-essay' }, h('p', { class: 'sample-text' }, sample.text)),
    reasons.length ? h(sub, null, 'Why the sample scores higher') : null,
    ...reasons.map((c) =>
      h(
        'div',
        { class: `card criterion-card crit-${c}` },
        h(level === 2 ? 'h4' : 'h5', null, criterionLabel(c, taskType)),
        markdown(sample.analysis[c]),
      ),
    ),
  );
}
