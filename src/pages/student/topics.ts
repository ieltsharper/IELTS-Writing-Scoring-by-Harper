// Topics I've written, and seeded topics not yet attempted.
import { api } from '../../api';
import { h } from '../../dom';
import { async, badge, empty, link, page, table } from '../../ui/components';
import { formatBand, formatDate, modeLabel, taskLabel } from '../../ui/format';

export interface TopicHistory {
  rows: Array<{
    essayId: string;
    topicId: string;
    topic: string;
    taskType: string;
    mode: string;
    date: string;
    overall: number | null;
  }>;
  notAttempted: string[];
}

export function topicHistoryView(
  data: TopicHistory,
  essayHref: (id: string) => string,
): HTMLElement {
  return h(
    'div',
    null,
    data.rows.length
      ? table(
          ['Topic', 'Task type', 'Mode', 'Date', 'Overall', ''],
          data.rows.map((r) => [
            r.topic,
            taskLabel(r.taskType),
            modeLabel(r.mode),
            formatDate(r.date),
            r.overall === null ? badge('Pending') : formatBand(r.overall),
            link(essayHref(r.essayId), 'Open essay'),
          ]),
          'Submitted essays by topic, newest first',
        )
      : empty('No submitted essays yet.'),
    h('h2', null, 'Topics not yet attempted'),
    data.notAttempted.length
      ? h(
          'ul',
          { class: 'tag-list' },
          ...data.notAttempted.map((t) => h('li', null, badge(t, 'warning'))),
        )
      : h('p', null, 'You have written about every topic. Great coverage!'),
  );
}

export function topicsPage(): Node {
  return page(
    "Topics I've written",
    async(
      () => api<TopicHistory>('topics.history'),
      (data) => topicHistoryView(data, (id) => `/essays/${id}`),
      'Loading topics…',
    ),
  );
}
