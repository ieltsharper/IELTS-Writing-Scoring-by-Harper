// Domain constants shared by the front end and the Apps Script back end.

export const TASK_TYPES = ['task1_academic', 'task2'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  task1_academic: 'Task 1 Academic',
  task2: 'Task 2',
};

export const MODES = ['practice', 'test', 'assigned'] as const;
export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Record<Mode, string> = {
  practice: 'Practice',
  test: 'Test',
  assigned: 'Assigned test',
};

/** Default time limits for timed modes, in minutes. */
export const TIME_LIMITS: Record<TaskType, number> = { task1_academic: 20, task2: 40 };

/** Grace period after the deadline before a timed essay is marked "over time". */
export const OVER_TIME_GRACE_SECONDS = 120;

export const MIN_WORDS: Record<TaskType, number> = { task1_academic: 150, task2: 250 };

export const ESSAY_STATUSES = ['draft', 'pending', 'in_review', 'scored'] as const;
export type EssayStatus = (typeof ESSAY_STATUSES)[number];

export const REWRITE_STATUSES = ['requested', 'submitted', 'overdue', 'waived'] as const;
export type RewriteStatus = (typeof REWRITE_STATUSES)[number];

/** Criterion keys, in the order of Scores.criterion_1 … criterion_4. */
export const CRITERIA = ['task', 'coherence', 'lexical', 'grammar'] as const;
export type Criterion = (typeof CRITERIA)[number];

export function criterionLabel(c: Criterion, taskType?: TaskType): string {
  switch (c) {
    case 'task':
      if (taskType === 'task1_academic') return 'Task Achievement';
      if (taskType === 'task2') return 'Task Response';
      return 'Task Achievement / Response';
    case 'coherence':
      return 'Coherence and Cohesion';
    case 'lexical':
      return 'Lexical Resource';
    case 'grammar':
      return 'Grammatical Range and Accuracy';
  }
}

export const CRITERION_SHORT: Record<Criterion, string> = {
  task: 'TA/TR',
  coherence: 'CC',
  lexical: 'LR',
  grammar: 'GRA',
};

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const LIMITS = {
  name: 80,
  email: 254,
  prompt: 4000,
  body: 20000,
  title: 200,
  label: 80,
  feedback: 10000,
  note: 1000,
  excerpt: 1000,
  correction: 1000,
  /** Pasted Claude replies and tool output. Sheets cells hold at most 50,000 characters. */
  rawText: 20000,
  errorsPerEssay: 200,
} as const;

export const SEED_CLASSES = ['IELTS 4', 'IELTS 5', 'IELTS 7', 'IELTS 8', 'IELTS Buddy'];

export const SEED_TOPICS = [
  'Education',
  'Environment',
  'Technology',
  'Health',
  'Work',
  'Society',
  'Government',
  'Crime',
  'Media',
  'Culture',
  'Transport',
  'Globalisation',
  'Family',
  'Economy',
  'Science',
];

export const OTHER_TOPIC_LABEL = 'Other';

export const SEED_SOURCES = ['Claude', 'AI4IELTS', 'Wispace', 'Perplexity'];
export const CLAUDE_SOURCE_NAME = 'Claude';

export const SEED_ERROR_CATEGORIES: Array<{ criterion: Criterion; label: string }> = [
  // Grammatical Range and Accuracy
  { criterion: 'grammar', label: 'Tense' },
  { criterion: 'grammar', label: 'Subject-verb agreement' },
  { criterion: 'grammar', label: 'Articles' },
  { criterion: 'grammar', label: 'Prepositions' },
  { criterion: 'grammar', label: 'Conditionals' },
  { criterion: 'grammar', label: 'Passive voice' },
  { criterion: 'grammar', label: 'Word order' },
  { criterion: 'grammar', label: 'Punctuation' },
  { criterion: 'grammar', label: 'Run-on sentence' },
  { criterion: 'grammar', label: 'Sentence fragment' },
  { criterion: 'grammar', label: 'Plurals and countability' },
  { criterion: 'grammar', label: 'Relative clauses' },
  { criterion: 'grammar', label: 'Limited sentence variety' },
  // Lexical Resource
  { criterion: 'lexical', label: 'Collocation' },
  { criterion: 'lexical', label: 'Word choice' },
  { criterion: 'lexical', label: 'Word form' },
  { criterion: 'lexical', label: 'Spelling' },
  { criterion: 'lexical', label: 'Repetition' },
  { criterion: 'lexical', label: 'Informal register' },
  { criterion: 'lexical', label: 'Memorised phrase' },
  { criterion: 'lexical', label: 'Imprecise vocabulary' },
  { criterion: 'lexical', label: 'Limited topic vocabulary' },
  // Coherence and Cohesion
  { criterion: 'coherence', label: 'Linking words' },
  { criterion: 'coherence', label: 'Paragraphing' },
  { criterion: 'coherence', label: 'Referencing' },
  { criterion: 'coherence', label: 'Progression' },
  { criterion: 'coherence', label: 'Overuse of connectors' },
  { criterion: 'coherence', label: 'Unclear topic sentence' },
  { criterion: 'coherence', label: 'Missing conclusion' },
  { criterion: 'coherence', label: 'Illogical sequencing' },
  // Task Achievement / Response
  { criterion: 'task', label: 'Off topic' },
  { criterion: 'task', label: 'No clear position' },
  { criterion: 'task', label: 'Underdeveloped idea' },
  { criterion: 'task', label: 'Missing overview (Task 1)' },
  { criterion: 'task', label: 'Missing key data' },
  { criterion: 'task', label: 'Inaccurate data' },
  { criterion: 'task', label: 'Irrelevant detail' },
  { criterion: 'task', label: 'Part of question not answered' },
  { criterion: 'task', label: 'Unsupported claim' },
  { criterion: 'task', label: 'Overgeneralisation' },
];

export const DEFAULT_SETTINGS: Record<string, string> = {
  daily_submission_cap: '3',
  admin_timezone: 'Asia/Ho_Chi_Minh',
  email_quota_reserve: '10',
};
