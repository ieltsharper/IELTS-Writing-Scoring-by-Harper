import type { Route } from '../../router';
import { claudeSetupPage } from './claudeSetup';
import { emailsPage } from './emails';
import { listsPage } from './lists';
import { queuePage } from './queue';
import { scoringPage } from './scoring';

export const routes: Route[] = [
  { pattern: '/admin', guard: 'admin', title: 'Queue', render: queuePage },
  { pattern: '/admin/score/:id', guard: 'admin', title: 'Scoring', render: scoringPage },
  { pattern: '/admin/lists', guard: 'admin', title: 'Lists', render: listsPage },
  { pattern: '/admin/claude', guard: 'admin', title: 'Claude setup', render: claudeSetupPage },
  { pattern: '/admin/emails', guard: 'admin', title: 'Email', render: emailsPage },
];
