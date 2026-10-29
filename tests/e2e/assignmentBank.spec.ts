// The admin picks an assignment question from the Task 2 prompt bank.
import { expect, test } from '@playwright/test';

const API = 'http://localhost:8788';

test('admin fills an assignment from the prompt bank', async ({ page }) => {
  await page.request.get(`${API}/__test/reset`);
  await page.request.post(`${API}/`, {
    headers: { 'Content-Type': 'text/plain' },
    data: JSON.stringify({ action: 'auth.requestLink', payload: { email: 'admin@example.com' } }),
  });
  const { link } = (await (
    await page.request.get(`${API}/__test/login-link?email=admin@example.com`)
  ).json()) as { link: string };
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Scoring queue' })).toBeVisible();

  await page.goto('#/admin/assignments/new');
  await page.getByRole('button', { name: 'Choose from the prompt bank' }).click();
  await page.getByRole('button', { name: 'Use this question' }).first().click();
  await expect(page.getByText('Question added.')).toBeVisible();
  const prompt = await page.locator('textarea[name="prompt"]').inputValue();
  expect(prompt.length).toBeGreaterThan(30);
  await expect(page.locator('input[name="title"]')).toHaveValue(/^Task 2: /);

  // Task 1 has no bank.
  await page.getByLabel('Task type').selectOption('task1_academic');
  await expect(page.getByRole('button', { name: 'Choose from the prompt bank' })).toBeHidden();
});
