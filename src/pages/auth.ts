// Login (emailed link), sign up, the login-link callback and the privacy notice.
import { api, ApiClientError } from '../api';
import { h, replace } from '../dom';
import { navigate, type RouteContext } from '../router';
import { setSession, type SessionUser } from '../session';
import { getConfig } from '../state';
import {
  async,
  busy,
  errorBox,
  field,
  link,
  loading,
  notice,
  page,
  selectEl,
  showFieldErrors,
} from '../ui/components';
import { localTimeZone } from '../ui/format';

export function loginPage(ctx: RouteContext): Node {
  const expired = ctx.query.get('expired')
    ? notice('warning', 'Your session has ended. Please log in again.')
    : null;
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'email', required: true });
  const status = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Email me a login link');
  const form = h(
    'form',
    { class: 'card narrow', novalidate: true },
    field({ label: 'Email address', control: email, name: 'email' }),
    submit,
    status,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!email.value.trim()) return showFieldErrors(form, { email: 'Enter your email address' });
    showFieldErrors(form, {});
    void busy(submit, 'Sending…', async () => {
      try {
        const res = await api<{ message: string }>('auth.requestLink', { email: email.value });
        replace(status, notice('success', res.message));
      } catch (err) {
        if (err instanceof ApiClientError && err.fields) showFieldErrors(form, err.fields);
        replace(status, errorBox(err));
      }
    });
  });
  return page(
    'Log in',
    expired,
    h('p', null, 'There are no passwords. Enter your email and we will send you a login link.'),
    form,
    h('p', null, 'New here? ', link('/signup', 'Create an account'), '.'),
  );
}

export function signupPage(): Node {
  return page(
    'Create an account',
    async(getConfig, (config) => {
      const name = h('input', {
        name: 'name',
        autocomplete: 'name',
        required: true,
        maxlength: '80',
      });
      const email = h('input', {
        type: 'email',
        name: 'email',
        autocomplete: 'email',
        required: true,
      });
      const cls = selectEl(
        'classId',
        config.classes.map((c) => ({ value: c.id, label: c.label })),
        '',
        'Choose your class',
      );
      const consent = h('input', { type: 'checkbox', name: 'consent', id: 'consent' });
      const status = h('div', { 'aria-live': 'polite' });
      const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Sign up');
      const form = h(
        'form',
        { class: 'card narrow', novalidate: true },
        field({ label: 'Full name', control: name, name: 'name' }),
        field({ label: 'Email address', control: email, name: 'email' }),
        field({ label: 'Class', control: cls, name: 'classId' }),
        h(
          'div',
          { class: 'field checkbox', dataset: { field: 'consent' } },
          consent,
          h(
            'label',
            { for: 'consent' },
            'I have read the ',
            link('/privacy', 'privacy notice', { target: '_blank' }),
            ' and agree that my essays are stored in my teacher’s Google account and may be pasted into Claude and other AI tools to help draft feedback. A human reviews every final score.',
          ),
          h('p', { class: 'field-error', 'aria-live': 'polite' }),
        ),
        submit,
        status,
      );
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const errors: Record<string, string> = {};
        if (name.value.trim().length < 2) errors.name = 'Enter your full name';
        if (!email.value.trim()) errors.email = 'Enter your email address';
        if (!cls.value) errors.classId = 'Choose your class';
        if (!consent.checked) errors.consent = 'Please agree to the privacy notice to continue.';
        showFieldErrors(form, errors);
        if (Object.keys(errors).length) return;
        void busy(submit, 'Signing up…', async () => {
          try {
            const res = await api<{ message: string }>('auth.signup', {
              name: name.value,
              email: email.value,
              classId: cls.value,
              consent: true,
              timezone: localTimeZone(),
            });
            replace(
              form,
              notice(
                'success',
                h('p', null, res.message),
                h('p', null, 'Check your inbox and open the link to log in.'),
              ),
            );
          } catch (err) {
            if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
            replace(status, errorBox(err));
          }
        });
      });
      return [form, h('p', null, 'Already registered? ', link('/login', 'Log in'), '.')];
    }),
  );
}

export function authCallbackPage(ctx: RouteContext): Node {
  const box = h('div', null, loading('Logging you in…'));
  const token = ctx.query.get('token') ?? '';
  // Remove the token from the address bar and history straight away.
  history.replaceState(null, '', '#/auth');
  api<{ sessionToken: string; user: SessionUser }>('auth.exchange', { token }).then(
    (res) => {
      setSession(res.sessionToken, res.user);
      navigate(res.user.role === 'admin' ? '/admin' : '/dashboard', { replace: true });
    },
    (err) => replace(box, errorBox(err), h('p', null, link('/login', 'Request a new login link'))),
  );
  return page('Logging in', box);
}

export function privacyPage(): Node {
  return page(
    'Privacy notice',
    h(
      'div',
      { class: 'card prose' },
      h('h2', null, 'What we store'),
      h(
        'p',
        null,
        'Your name, email, class, target band and exam date (if you add them), the essays you write, chart images you upload, your scores, feedback and the errors your teacher tags.',
      ),
      h('h2', null, 'Where it is stored'),
      h(
        'p',
        null,
        'Everything is stored in your teacher’s own Google account: a private Google Sheet and a private Google Drive folder. They are never shared publicly. Emails are sent from your teacher’s Gmail.',
      ),
      h('h2', null, 'How AI tools are used'),
      h(
        'p',
        null,
        'To help draft feedback, your teacher may paste your essay into Claude and other AI writing tools (such as AI4IELTS, Wispace and Perplexity). These drafts are only reference material for your teacher. A human reviews every final score, and only the final score and feedback your teacher approves are shown to you.',
      ),
      h('h2', null, 'Your choices'),
      h(
        'p',
        null,
        'You can update your details or delete your account at any time from Settings. Deleting your account removes your rows from the Sheet, moves your essay folders to the Drive trash and ends all your sessions.',
      ),
      h('h2', null, 'Login'),
      h(
        'p',
        null,
        'There are no passwords. Login links work once and expire after 15 minutes. Your session is kept in this browser for 30 days or until you log out.',
      ),
    ),
  );
}
