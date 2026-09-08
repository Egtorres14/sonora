import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { encodeWav16 } from '../../services/audio/wav';
import { decodePcm } from '../../services/audio/wav';
import { extractFeatures } from '../../services/audio/features';
import { createReview } from '../../services/review';
import { exportDataset } from '../../services/library';

const audio = () => {
  const sr = 48000;
  const channel = Float32Array.from({ length: sr * 60 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / sr) * 0.1);
  return { name: 'campana_validacion.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav16([channel], sr)) };
};
// Los recorridos existentes entran como profesor; el menú de roles se prueba en su propio test.
const asTeacher = () => { localStorage.setItem('sonora.session.v1', JSON.stringify({ role: 'teacher', enteredAt: new Date().toISOString() })); };
test.beforeEach(async ({ page }) => { await page.addInitScript(asTeacher); await page.goto('/'); });

test('landing local, móvil sin desbordamiento y modelo sin datos', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Escucha.*Mide/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/sonora-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/sonora-mobile.png', fullPage: true });
  await page.getByRole('button', { name: /Modelo local/ }).click();
  await expect(page.getByRole('heading', { name: 'Primero los datos.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrenar modelo local', exact: true })).toBeDisabled();
});

test('archivo corrupto seguido de válido, corrección y persistencia sin IA', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:3017')) external.push(request.url()); });
  await page.getByLabel('Subir archivos de audio').setInputFiles({ name: 'roto.wav', mimeType: 'audio/wav', buffer: Buffer.from('archivo wav corrupto para prueba') });
  await expect(page.getByRole('alert')).toContainText('roto.wav');
  await expect(page.getByRole('button', { name: 'Seleccionar archivos' })).toBeEnabled();
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();
  await expect(page.getByTestId('final-score')).toContainText('En revisión');
  await expect(page.getByRole('button', { name: 'Reproducir', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await page.getByLabel('Sinopsis del estudiante').fill('Paisaje sonoro construido a partir de una campana.');
  for (const name of ['Pitch shift', 'Time stretch', 'Reversa', 'Filtros']) await page.getByRole('group', { name: `Revisión de ${name}`, exact: true }).getByRole('button', { name: 'Presente', exact: true }).click();
  await page.getByLabel('Sobreprocesamiento', { exact: true }).selectOption('none');
  await page.getByLabel('Efectos extra', { exact: true }).selectOption('absent');
  await expect(page.getByTestId('final-score')).toHaveText('30/ 30');
  await page.getByRole('group', { name: 'Revisión de Pitch shift', exact: true }).getByRole('button', { name: 'Ausente', exact: true }).click();
  await expect(page.getByTestId('final-score')).toHaveText('27,5/ 30');
  await page.getByLabel('Ajustar nota manualmente').fill('23.5');
  await page.getByLabel('Feedback para el estudiante').fill('Comentario que debe conservar la nota manual.');
  await expect(page.getByTestId('final-score')).toHaveText('23,5/ 30');
  await expect(page.getByText('Guardando cambios…')).toHaveCount(0);
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: 'output/playwright/sonora-analysis.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).first().click();
  await expect(page.getByTestId('final-score')).toHaveText('23,5/ 30');
  await expect(page.getByLabel('Feedback para el estudiante')).toHaveValue('Comentario que debe conservar la nota manual.');
  await page.getByRole('button', { name: 'Espectrograma', exact: true }).click();
  await expect(page.getByRole('img', { name: /Espectrograma del audio/ })).toBeVisible();
  expect(external).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('lote deduplica, continúa tras un error e importa JSON sin sobrescribir', async ({ page }) => {
  const first = audio();
  await page.getByLabel('Subir archivos de audio').setInputFiles([first, { ...first, name: 'duplicado.wav' }, { name: 'roto.wav', mimeType: 'audio/wav', buffer: Buffer.from('error de contenedor wav') }]);
  await expect(page.getByRole('alert')).toContainText('roto.wav');
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exportar JSON', exact: true }).click();
  const saved = await download; const filename = await saved.path();
  await page.getByLabel('Importar colección JSON').setInputFiles(filename!);
  await expect(page.locator('.notice-banner')).toContainText('1 duplicados conservados');
  await page.getByLabel('Importar colección JSON').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":100,"records":[]}') });
  await expect(page.getByRole('alert')).toContainText('colección Sonora válida');
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('demos identificadas y excluidas del entrenamiento', async ({ page }) => {
  await page.getByRole('button', { name: /01.*Campana de estudio/ }).click();
  await expect(page.getByRole('heading', { name: 'campana_estudio.wav', exact: true })).toBeVisible();
  await expect(page.getByText('DEMO SINTÉTICA', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Modelo local/ }).click();
  await expect(page.getByRole('button', { name: 'Entrenar modelo local', exact: true })).toBeDisabled();
  await expect(page.locator('.learning-counters').getByText('Muestras reales')).toContainText('0');
});

test('importa corpus de prueba, entrena en worker y conserva el modelo al recargar', async ({ page }) => {
  // Test-only descriptors: exercise the pipeline, not real-world accuracy.
  const base = extractFeatures(decodePcm(encodeWav16([new Float32Array(4800)], 48000))!);
  const samples = Array.from({ length: 24 }, (_, i) => {
    const positive = i % 2 === 0;
    const r = createReview(i.toString(16).padStart(64, '0'), `fixture-${i}.wav`, { ...base, spectrum: { ...base.spectrum, flatness: positive ? 0.9 : 0.1, centroidHz: positive ? 6000 : 200, ltas: base.spectrum.ltas.map((b, j) => ({ ...b, db: positive ? -j : j - 48 })) } });
    r.sourceGroup = `fixture-source-${Math.floor(i / 2)}`;
    r.labels.filtros = positive ? 'present' : 'absent';
    return r;
  });
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByLabel('Importar colección JSON').setInputFiles({ name: 'test-corpus.json', mimeType: 'application/json', buffer: Buffer.from(exportDataset(samples)) });
  await expect(page.locator('.notice-banner')).toContainText('24 registros importados');
  await page.getByRole('button', { name: /Modelo local/ }).click();
  await page.getByRole('button', { name: 'Entrenar modelo local', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lo que dicen los datos retenidos.' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Filtros');
  await page.reload();
  await page.getByRole('button', { name: /Modelo local/ }).click();
  await expect(page.getByRole('button', { name: 'Volver a entrenar' })).toBeEnabled();
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('AIFF conserva su formato medido y puede reproducirse en el navegador', async ({ page }) => {
  const frames = 48000;
  const bytes = Buffer.alloc(54 + frames * 2);
  bytes.write('FORM', 0); bytes.writeUInt32BE(bytes.length - 8, 4); bytes.write('AIFF', 8);
  bytes.write('COMM', 12); bytes.writeUInt32BE(18, 16); bytes.writeUInt16BE(1, 20);
  bytes.writeUInt32BE(frames, 22); bytes.writeUInt16BE(16, 26);
  bytes.set([0x40, 0x0e, 0xbb, 0x80, 0, 0, 0, 0, 0, 0], 28);
  bytes.write('SSND', 38); bytes.writeUInt32BE(frames * 2 + 8, 42);
  for (let i = 0; i < frames; i++) bytes.writeInt16BE(Math.round(3000 * Math.sin(2 * Math.PI * 440 * i / 48000)), 54 + i * 2);
  await page.getByLabel('Subir archivos de audio').setInputFiles({ name: 'referencia.aiff', mimeType: 'audio/aiff', buffer: bytes });
  await expect(page.getByRole('heading', { name: 'referencia.aiff', exact: true })).toBeVisible();
  await expect(page.locator('.file-heading')).toContainText('48.000 Hz');
  await expect(page.locator('.file-heading')).toContainText('16 bit');
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
});

test('menú de entrada: el estudiante entrega con su nombre y el profesor lo ve con la nota', async ({ page }) => {
  // El init script del beforeEach reentraría como profesor en cada navegación: salimos desde la app.
  await page.getByRole('button', { name: /Salir/ }).click();
  await expect(page.getByRole('heading', { name: '¿Quién entra?' })).toBeVisible();
  // Estudiante: nombre obligatorio
  await page.getByLabel('Nombre y apellidos').fill('María Pérez');
  await page.getByRole('button', { name: 'Entrar como estudiante' }).click();
  await expect(page.getByRole('heading', { name: /Sube tu/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Biblioteca/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Modelo local/ })).toHaveCount(0);
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();
  await expect(page.locator('.file-heading')).toContainText('Tu entrega');
  await expect(page.getByText('CRITERIO DEL PROFESOR')).toHaveCount(0);
  await page.getByLabel('Sinopsis de la pieza').fill('Paisaje sonoro construido a partir de una campana.');
  await page.getByRole('button', { name: /Mis entregas/ }).first().click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('En revisión');
  // Profesor: crea el PIN, ve el nombre del estudiante y califica
  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('PIN', { exact: true }).fill('Felipebolano2026');
  await page.getByRole('button', { name: 'Entrar como profesor' }).click();
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await expect(page.locator('tbody tr')).toContainText('María Pérez');
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.locator('.file-heading')).toContainText('Entregado por María Pérez');
  for (const tool of ['Pitch shift', 'Time stretch', 'Reversa', 'Filtros', 'Loops']) await page.getByRole('group', { name: `Revisión de ${tool}` }).getByRole('button', { name: 'Presente' }).click();
  await page.getByLabel('Sobreprocesamiento').selectOption('none');
  await page.getByLabel('Efectos extra').selectOption('absent');
  await expect(page.getByTestId('final-score')).toContainText('30');
  await page.getByLabel('Feedback para el estudiante').fill('Buen trabajo con la reversa.');
  await page.getByRole('button', { name: 'Publicar al estudiante' }).click();
  await expect(page.getByRole('button', { name: 'Retirar publicación' })).toBeVisible();
  // Rúbrica editable: sin exigir 48 kHz y con 3 herramientas obligatorias el total cambia
  await page.getByRole('button', { name: /Rúbrica/ }).click();
  await page.getByLabel('Puntos extra por efectos adicionales').fill('1');
  await page.getByRole('button', { name: 'Guardar rúbrica' }).click();
  await expect(page.locator('.notice-banner')).toContainText('Rúbrica guardada');
  // El estudiante vuelve a entrar y ve su nota y el comentario
  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('Nombre y apellidos').fill('maria perez');
  await page.getByRole('button', { name: 'Entrar como estudiante' }).click();
  await page.getByRole('button', { name: /Mis entregas/ }).first().click();
  await expect(page.locator('tbody tr')).toContainText('Calificado');
  await expect(page.locator('tbody tr')).toContainText('30 / 30');
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.getByTestId('student-score')).toContainText('30');
  await expect(page.getByText('Buen trabajo con la reversa.')).toBeVisible();
  // El PIN incorrecto no da acceso al profesor
  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('PIN', { exact: true }).fill('otro');
  await page.getByRole('button', { name: 'Entrar como profesor' }).click();
  await expect(page.getByRole('alert')).toContainText('PIN incorrecto');
});

test('evidencias con tiempos y motores de IA', async ({ page }) => {
  await page.getByRole('button', { name: /Edición con clics/ }).click();
  await expect(page.getByRole('heading', { name: 'campana_cortes.wav', exact: true })).toBeVisible();
  const panel = page.locator('.evidence-panel');
  await expect(panel.getByRole('heading', { name: 'Cada punto tiene su momento.' })).toBeVisible();
  await expect(panel.locator('.evidence-row.medido').first()).toContainText(/Clic|Corte/);
  await page.getByRole('group', { name: 'Revisión de Reversa' }).getByRole('button', { name: 'Presente' }).click();
  await page.getByLabel('Evidencia de Reversa').fill('0:12–0:18 cola invertida');
  await expect(panel.locator('.evidence-row.profesor').first()).toContainText('0:12–0:18');
  await expect(page.locator('.evidence-timeline .tl-lane.profesor .tl-range')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Reproducir', exact: true })).toBeEnabled();
  await panel.locator('button.evidence-row.profesor').first().click();
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Motores de IA/ }).click();
  await expect(page.getByRole('radio', { name: /Modelo local/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: /Google Gemini/ }).click();
  await expect(page.getByRole('checkbox', { name: /Permitir a los estudiantes/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Guardar motores' }).click();
  await expect(page.locator('.notice-banner')).toContainText('gemini');
});
