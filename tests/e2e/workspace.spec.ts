import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { encodeWav16 } from '../../services/audio/wav';
import { decodePcm } from '../../services/audio/wav';
import { extractFeatures, FEATURES_VERSION } from '../../services/audio/features';
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
  // Se aparta una quinta parte de los 12 orígenes (2 orígenes, 4 muestras) antes de entrenar
  await page.getByRole('button', { name: 'Congelar conjunto de evaluación' }).click();
  await expect(page.getByTestId('holdout-panel')).toContainText('4 muestras de 2 orígenes');
  await page.getByRole('button', { name: 'Entrenar modelo local', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lo que dicen los datos retenidos.' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Filtros');
  // La columna «Congelado» lleva la exactitud sobre las 4 muestras apartadas
  await expect(page.locator('thead')).toContainText('Congelado');
  await expect(page.locator('tbody tr')).toContainText('(4)');
  await page.reload();
  await page.getByRole('button', { name: /Modelo local/ }).click();
  await expect(page.getByRole('button', { name: 'Volver a entrenar' })).toBeEnabled();
  await expect(page.getByTestId('holdout-panel')).toContainText('4 muestras de 2 orígenes');
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

test('guía de uso antes de entrar y desde cada rol', async ({ page }) => {
  await page.getByRole('button', { name: 'Salir' }).click();
  await page.getByRole('button', { name: /Cómo se usa/ }).click();
  await expect(page.getByRole('heading', { name: /Entregar bien/ })).toBeVisible();
  await page.getByRole('group', { name: 'Guía para' }).getByRole('button', { name: 'Profesor' }).click();
  await expect(page.getByRole('heading', { name: /Del archivo a la nota/ })).toBeVisible();
  await expect(page.locator('.guide-steps li')).toHaveCount(10);
  await page.getByRole('button', { name: 'Volver a la entrada' }).click();
  await expect(page.getByRole('heading', { name: '¿Quién entra?' })).toBeVisible();
  await page.getByLabel('Nombre y apellidos').fill('Ana Ruiz');
  await page.getByRole('button', { name: 'Entrar como estudiante' }).click();
  await page.getByRole('button', { name: /Guía de uso/ }).click();
  await expect(page.locator('.guide-steps li')).toHaveCount(7);
});

test('muestras del corpus: escucha, importación y modelo publicado', async ({ page }) => {
  await page.getByRole('button', { name: /Muestras/ }).click();
  await expect(page.getByRole('heading', { name: /grabaciones · .* muestras etiquetadas/ })).toBeVisible();
  const first = page.locator('.corpus-source').first();
  await expect(first.locator('audio')).toHaveCount(6);
  await first.getByRole('button', { name: /Ver las \d+ variantes/ }).click();
  await expect(first.locator('table tbody tr').first()).toBeVisible();
  expect(await first.locator('table tbody tr').count()).toBeGreaterThanOrEqual(17); // 18 variantes salvo que dos ajustes coincidan
  await expect(page.getByRole('heading', { name: /Entrenado el/ })).toBeVisible();
  await page.getByRole('button', { name: 'Importar corpus a la biblioteca' }).click();
  await expect(page.locator('.notice-banner')).toContainText(/Corpus importado: \d+ registros nuevos .* modelo entrenado cargado/, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Corpus importado' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Modelo cargado' })).toBeDisabled();
  await page.getByRole('button', { name: /Modelo local/ }).click();
  await expect(page.getByRole('heading', { name: 'Un primer modelo, medible.' })).toBeVisible();
  await expect(page.locator('.notice')).toHaveCount(0);
  // El borrador de feedback se redacta sin IA externa
  await page.getByRole('button', { name: /Laboratorio/ }).click();
  await page.getByRole('button', { name: /Edición con clics/ }).click();
  await expect(page.getByRole('heading', { name: 'campana_cortes.wav', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redactar borrador' }).click();
  await expect(page.getByLabel('Feedback para el estudiante')).toHaveValue(/clics|Quedan por revisar/);
});

test('el laboratorio vuelve a la zona de carga sin pasar por la biblioteca', async ({ page }) => {
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();
  // Desde el propio análisis
  await page.getByRole('button', { name: 'Subir otro archivo' }).click();
  await expect(page.getByRole('heading', { name: /Escucha\./ })).toBeVisible();
  await expect(page.locator('.breadcrumb')).toContainText('Laboratorio');
  // Y volviendo a pulsar «Laboratorio» con un archivo abierto
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Laboratorio/ }).first().click();
  await expect(page.getByRole('heading', { name: /Escucha\./ })).toBeVisible();
});

test('el estudiante no ve las decisiones del profesor hasta que se publican', async ({ page }) => {
  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('Nombre y apellidos').fill('Lucía Soler');
  await page.getByRole('button', { name: 'Entrar como estudiante' }).click();
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.locator('.file-heading')).toContainText('Tu entrega');

  // El profesor etiqueta pero no publica
  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('PIN', { exact: true }).fill('Felipebolano2026');
  await page.getByRole('button', { name: 'Entrar como profesor' }).click();
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await page.getByRole('group', { name: 'Revisión de Reversa' }).getByRole('button', { name: 'Presente' }).click();
  await page.getByLabel('Evidencia de Reversa').fill('0:12–0:18 cola invertida');
  await expect(page.locator('.evidence-panel')).toContainText('Reversa confirmado');

  // La estudiante ve sus mediciones, pero ninguna decisión del profesor
  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('Nombre y apellidos').fill('Lucía Soler');
  await page.getByRole('button', { name: 'Entrar como estudiante' }).click();
  await page.getByRole('button', { name: /Mis entregas/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.locator('.evidence-panel')).not.toContainText('Reversa confirmado');
  await expect(page.locator('.evidence-panel .evidence-source.profesor')).toHaveCount(0);
  await expect(page.getByText('Pendiente de revisión.')).toBeVisible();

  // Al publicar, las mismas evidencias llegan a la estudiante
  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('PIN', { exact: true }).fill('Felipebolano2026');
  await page.getByRole('button', { name: 'Entrar como profesor' }).click();
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  for (const tool of ['Pitch shift', 'Time stretch', 'Filtros', 'Loops']) await page.getByRole('group', { name: `Revisión de ${tool}` }).getByRole('button', { name: 'Presente' }).click();
  await page.getByLabel('Sobreprocesamiento').selectOption('none');
  await page.getByLabel('Efectos extra').selectOption('absent');
  await page.getByRole('button', { name: 'Publicar al estudiante' }).click();
  await expect(page.getByRole('button', { name: 'Retirar publicación' })).toBeVisible();

  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('Nombre y apellidos').fill('Lucía Soler');
  await page.getByRole('button', { name: 'Entrar como estudiante' }).click();
  await page.getByRole('button', { name: /Mis entregas/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.locator('.evidence-panel')).toContainText('Reversa confirmado');
});

test('el profesor marca sin ratón, la etiqueta se propone y la marca aparece como evidencia', async ({ page }) => {
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();

  await page.getByLabel('Herramienta que vas a marcar').selectOption('reversa');
  await page.getByRole('button', { name: 'Marcar desde el tiempo actual' }).click();

  // La etiqueta pendiente pasa a «presente» y se avisa
  await expect(page.getByText(/Reversa pasa a «presente»/)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Revisión de Reversa' }).getByRole('button', { name: 'Presente' })).toHaveAttribute('aria-pressed', 'true');

  // Los tiempos se ajustan con los campos numéricos y el comentario llega a las evidencias
  await page.getByLabel('Final de la marca de Reversa').fill('4.5');
  await page.getByLabel('Comentario de la marca de Reversa').fill('Cola invertida');
  await expect(page.locator('.evidence-panel')).toContainText('Cola invertida');

  // Borrar la marca no devuelve la etiqueta a pendiente
  await page.getByRole('button', { name: 'Borrar la marca de Reversa' }).click();
  await expect(page.locator('.mark-list')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Revisión de Reversa' }).getByRole('button', { name: 'Presente' })).toHaveAttribute('aria-pressed', 'true');
});

test('las marcas sobreviven a recargar y el zoom está disponible', async ({ page }) => {
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();
  await page.getByLabel('Herramienta que vas a marcar').selectOption('loops');
  await page.getByRole('button', { name: 'Marcar desde el tiempo actual' }).click();
  await page.getByLabel('Comentario de la marca de Loops').fill('Bucle de dos compases');
  await expect(page.getByRole('button', { name: '200 px/s' })).toBeVisible();

  // La cola de guardado (services/save-queue.ts) agrupa las escrituras: hay que dejarla vaciar.
  await expect(page.locator('.workspace-topline')).not.toContainText('Guardando cambios');
  await page.reload();
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.getByLabel('Comentario de la marca de Loops')).toHaveValue('Bucle de dos compases');
});

test('el formato de nombre que exige el profesor se enseña, se prueba y puntúa', async ({ page }) => {
  // El profesor declara el formato y lo prueba antes de guardar
  await page.getByRole('button', { name: /Rúbrica/ }).click();
  await page.getByLabel('Formato exigido del nombre de archivo').fill('{estudiante}_ejercicio{numero}');
  await expect(page.getByText('Un nombre válido sería «apellido_ejercicio3.wav».')).toBeVisible();
  await page.getByLabel('Probar un nombre').fill('asdkjh.wav');
  await expect(page.getByTestId('name-verdict')).toContainText('No puntuaría');
  await page.getByLabel('Probar un nombre').fill('soler_ejercicio2.wav');
  await page.getByLabel('Como si lo entregara').fill('Lucía Soler');
  await expect(page.getByTestId('name-verdict')).toContainText('Puntuaría');
  await page.getByRole('button', { name: 'Guardar rúbrica' }).click();
  await expect(page.locator('.notice-banner')).toContainText('Rúbrica guardada');

  // La estudiante ve el formato antes de subir, con su propio nombre en el ejemplo
  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('Nombre y apellidos').fill('Lucía Soler');
  await page.getByRole('button', { name: 'Entrar como estudiante' }).click();
  await expect(page.getByTestId('name-requirement')).toContainText('lucia_ejercicio3.wav');
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.locator('.file-heading')).toContainText('Tu entrega');

  // «campana_validacion.wav» no sigue el formato: el profesor ve 0 puntos y el motivo
  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('PIN', { exact: true }).fill('Felipebolano2026');
  await page.getByRole('button', { name: 'Entrar como profesor' }).click();
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await page.getByText('Ver desglose de criterios').click();
  const nameLine = page.locator('.score-details > div', { hasText: 'Nombre de archivo' });
  await expect(nameLine.locator('span')).toHaveText('0');
  await expect(nameLine).toContainText('no sigue el formato exigido');
});

/** Una colección exportada con un registro medido por una versión anterior del DSP, sin audio. */
const olderCollection = () => {
  const sr = 48000;
  const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(sr * 2)], sr))!);
  const [major] = FEATURES_VERSION.split('.');
  const version = `${major}.0.0`;
  const record = createReview('e'.repeat(64), 'antigua_sin_audio.wav', { ...features, version, analysis: { ...features.analysis, version } });
  return { name: 'antigua.json', mimeType: 'application/json', buffer: Buffer.from(exportDataset([{ ...record, sourceGroup: 'legado-01', synopsis: 'Registro de una versión anterior.' }])) };
};

test('un registro de una versión anterior sin audio puntúa, se señala y no entrena', async ({ page }) => {
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByLabel('Importar colección JSON').setInputFiles(olderCollection());
  await expect(page.locator('.notice-banner')).toContainText('1 registros importados');
  await expect(page.locator('tbody tr')).toContainText('reanálisis pendiente');

  await page.getByRole('button', { name: /Modelo local/ }).click();
  await expect(page.getByTestId('outdated-note')).toContainText('1 muestra(s) en una versión anterior');
  await expect(page.getByRole('button', { name: 'Reanalizar las que tienen audio' })).toBeDisabled();

  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^antigua_sin_audio/ }).click();
  await expect(page.getByTestId('outdated-record')).toContainText('versión anterior');
  await expect(page.getByTestId('final-score')).toBeVisible();
});

/** Envejece los registros guardados en IndexedDB, como si los hubiera medido una versión anterior. */
const ageStoredRecords = (page: Page) => page.evaluate(([major]) => new Promise<void>((resolve, reject) => {
  const open = indexedDB.open('sonora-library-v1');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    const all = store.getAll();
    all.onsuccess = () => { for (const r of all.result) { r.features.version = `${major}.0.0`; r.features.analysis.version = `${major}.0.0`; store.put(r); } };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
}), [FEATURES_VERSION.split('.')[0]]);

test('abrir un registro antiguo con audio lo reanaliza y lo pone al día', async ({ page }) => {
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-topline')).not.toContainText('Guardando cambios');

  await ageStoredRecords(page);
  await page.reload();

  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await expect(page.locator('tbody tr')).toContainText('reanálisis pendiente');
  await page.getByRole('button', { name: /Modelo local/ }).click();
  await expect(page.getByRole('button', { name: 'Reanalizar las que tienen audio' })).toBeEnabled();

  // Camino 1: abrirla basta, el análisis que ya se hace al abrir guarda las características nuevas.
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();
  await expect(page.locator('.analysis-progress')).toHaveCount(0);
  await expect(page.locator('.workspace-topline')).not.toContainText('Guardando cambios');
  await page.reload(); // La colección en memoria se actualiza sola; se recarga para leer lo persistido.
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await expect(page.locator('tbody tr')).not.toContainText('reanálisis pendiente');

  // Camino 2: el lote desde Modelo local, con el mismo registro envejecido de nuevo.
  await ageStoredRecords(page);
  await page.reload();
  await page.getByRole('button', { name: /Modelo local/ }).click();
  await expect(page.getByRole('button', { name: 'Reanalizar las que tienen audio' })).toBeEnabled();
  await page.getByRole('button', { name: 'Reanalizar las que tienen audio' }).click();
  await expect(page.locator('.notice-banner')).toContainText('1 muestra(s) reanalizada(s)');
  await expect(page.locator('.workspace-topline')).not.toContainText('Guardando cambios');
  await page.reload(); // Igual que arriba: se comprueba lo persistido, no solo el estado en memoria.
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await expect(page.locator('tbody tr')).not.toContainText('reanálisis pendiente');
});

test('la nota publicada no se mueve aunque cambie la rúbrica, y el profesor puede volver a publicar', async ({ page }) => {
  // La estudiante entrega con sinopsis
  await page.getByRole('button', { name: /Salir/ }).click();
  await page.getByLabel('Nombre y apellidos').fill('Marta Vidal');
  await page.getByRole('button', { name: 'Entrar como estudiante' }).click();
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.locator('.file-heading')).toContainText('Tu entrega');
  await page.getByLabel('Sinopsis de la pieza').fill('Paisaje sonoro construido a partir de una campana.');
  await expect(page.locator('.workspace-topline')).not.toContainText('Guardando cambios');

  // El profesor califica todo y publica: 30 / 30
  const asTeacherOpen = async () => {
    await page.getByRole('button', { name: /Salir/ }).click();
    await page.getByLabel('PIN', { exact: true }).fill('Felipebolano2026');
    await page.getByRole('button', { name: 'Entrar como profesor' }).click();
    await page.getByRole('button', { name: /Biblioteca/ }).first().click();
    await page.getByRole('button', { name: /^campana_validacion/ }).click();
  };
  await asTeacherOpen();
  for (const tool of ['Pitch shift', 'Time stretch', 'Reversa', 'Filtros', 'Loops']) await page.getByRole('group', { name: `Revisión de ${tool}` }).getByRole('button', { name: 'Presente' }).click();
  await page.getByLabel('Sobreprocesamiento').selectOption('none');
  await page.getByLabel('Efectos extra').selectOption('absent');
  await expect(page.getByTestId('final-score')).toContainText('30');
  await page.getByRole('button', { name: 'Publicar al estudiante' }).click();
  await expect(page.getByRole('button', { name: 'Retirar publicación' })).toBeVisible();
  await expect(page.getByTestId('grade-drift')).toHaveCount(0);
  await expect(page.locator('.workspace-topline')).not.toContainText('Guardando cambios');

  // El profesor cambia la rúbrica: el nombre de archivo deja de puntuar
  await page.getByRole('button', { name: /Rúbrica/ }).click();
  await page.getByLabel('Puntos por nombre de archivo').fill('0');
  await page.getByRole('button', { name: 'Guardar rúbrica' }).click();
  await expect(page.locator('.notice-banner')).toContainText('Rúbrica guardada');

  // Ve la deriva: publicada 30, ahora calcularía 27,5
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await expect(page.locator('tbody tr')).toContainText('difiere de lo publicado');
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.getByTestId('grade-drift')).toContainText('Publicada 30');
  await expect(page.getByTestId('grade-drift')).toContainText('ahora calcularía 27,5');

  // La estudiante sigue viendo la nota publicada
  const asStudentOpen = async () => {
    await page.getByRole('button', { name: /Salir/ }).click();
    await page.getByLabel('Nombre y apellidos').fill('Marta Vidal');
    await page.getByRole('button', { name: 'Entrar como estudiante' }).click();
    await page.getByRole('button', { name: /Mis entregas/ }).first().click();
  };
  await asStudentOpen();
  await expect(page.locator('tbody tr')).toContainText('30 / 30');
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.getByTestId('student-score')).toContainText('30');

  // El profesor vuelve a publicar y la estudiante ve la nueva nota
  await asTeacherOpen();
  await page.getByRole('button', { name: 'Volver a publicar' }).click();
  await expect(page.getByTestId('grade-drift')).toHaveCount(0);
  await expect(page.locator('.workspace-topline')).not.toContainText('Guardando cambios');
  await asStudentOpen();
  await expect(page.locator('tbody tr')).toContainText('27.5 / 27.5');
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.getByTestId('student-score')).toContainText('27,5');
});
