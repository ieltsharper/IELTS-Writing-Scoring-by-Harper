// A Task 1 chart picked as AVIF is converted to PNG in the browser before upload.
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const API = 'http://localhost:8788';

test('an AVIF chart is converted to PNG and saved', async ({ page }) => {
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

  await page.goto('#/admin/essays/new');
  await page.getByLabel('Student', { exact: true }).selectOption({ label: '+ New student…' });
  await page.getByLabel('Full name').fill('Avif Student');
  await page.getByLabel('Task type').selectOption('task1_academic');
  await page.getByLabel('Diagram type').selectOption({ label: 'Dynamic' });
  await page.getByLabel('Task prompt').fill('The chart shows sales of three products in 2020.');
  await page
    .getByLabel(/Chart or diagram image \(PNG, JPG or AVIF/)
    .setInputFiles(fileURLToPath(new URL('./fixtures/chart.avif', import.meta.url)));
  await page
    .getByLabel('Essay text')
    .fill('The bar chart compares the sales of three products in 2020. '.repeat(16));
  await page.getByRole('button', { name: 'Add and score now' }).click();
  await expect(page.getByRole('heading', { name: /Score: Avif Student/ })).toBeVisible();

  // Stored and served as PNG, so it can be attached in Claude.
  const download = page.getByRole('link', { name: 'Download chart image' }).first();
  await expect(download).toHaveAttribute('download', 'chart.png');
  await expect(download).toHaveAttribute('href', /^data:image\/png;base64,iVBORw0KGgo/);
});
