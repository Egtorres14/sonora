import { expect, test } from '@playwright/test';

// Never include dev-injected credentials in traces or screenshots.
test.use({ trace: 'off', screenshot: 'off' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sonora.session.v1', JSON.stringify({ role: 'teacher', enteredAt: new Date().toISOString() })));
  await page.goto('/');
  await page.getByRole('button', { name: /Motores de IA/ }).click();
});

test('Gemini prueba el modelo elegido y guarda clave, selección y resultado al recargar', async ({ page }) => {
  const called: string[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    called.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: { candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }], modelVersion: 'gemini-3.8-flash' } });
  });
  const gemini = page.getByRole('radio', { name: /Google Gemini/ }).locator('..');
  await gemini.getByRole('radio').click();
  await page.getByLabel('Clave de API de Google Gemini', { exact: true }).fill('fixture-gemini-key');
  await page.getByLabel('Modelo de Google Gemini', { exact: true }).selectOption('gemini-3.8-flash');
  await gemini.getByRole('button', { name: 'Probar', exact: true }).click();
  await expect(gemini.locator('.key-status')).toContainText('gemini-3.8-flash respondió');
  expect(called).toEqual(['/v1beta/models/gemini-3.8-flash:generateContent']);
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /Motores de IA/ }).click();
  await expect(page.getByLabel('Clave de API de Google Gemini', { exact: true })).toHaveValue('fixture-gemini-key');
  await expect(gemini.locator('.key-status')).toContainText('gemini-3.8-flash respondió');
  await page.reload();
  await page.getByRole('button', { name: /Motores de IA/ }).click();
  await expect(gemini.getByRole('radio')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Modelo de Google Gemini', { exact: true })).toHaveValue('gemini-3.8-flash');
  await expect(page.getByLabel('Clave de API de Google Gemini', { exact: true })).toHaveValue('fixture-gemini-key');
  await expect(gemini.locator('.key-status')).toContainText('gemini-3.8-flash respondió');
  await page.getByLabel('Modelo de Google Gemini', { exact: true }).selectOption('gemini-3.5-flash-lite');
  await expect(gemini.locator('.key-status')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /Motores de IA/ }).click();
  await expect(page.getByLabel('Modelo de Google Gemini', { exact: true })).toHaveValue('gemini-3.5-flash-lite');
  await expect(gemini.locator('.key-status')).toHaveCount(0);
});

test('no anuncia clave guardada cuando el navegador rechaza la escritura', async ({ page }) => {
  const gemini = page.getByRole('radio', { name: /Google Gemini/ }).locator('..');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'sonora.key.gemini') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const key = page.getByLabel('Clave de API de Google Gemini', { exact: true });
  await key.fill('fixture-session-only');
  await expect(gemini.getByText('Clave disponible solo en esta sesión', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /Motores de IA/ }).click();
  await expect(key).toHaveValue('fixture-session-only');
  await expect(gemini.getByText('Clave disponible solo en esta sesión', { exact: false })).toBeVisible();
});
