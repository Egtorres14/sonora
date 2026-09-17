import { test, expect, type Locator, type Page } from '@playwright/test';
import { encodeWav16 } from '../../services/audio/wav';
import { decodePcm } from '../../services/audio/wav';
import { extractFeatures } from '../../services/audio/features';
import { createReview } from '../../services/review';
import { exportDataset } from '../../services/library';

/**
 * Genera las capturas de las guías (public/guia/*.png) recorriendo la app real con datos de
 * ejemplo. Antes de cada captura se señala en pantalla lo que importa —recuadro y globos
 * numerados— con una capa que solo existe en el momento de capturar; nada de esto viaja en la app.
 *
 *   npm run guia:capturas
 *
 * Los textos de components/GuideView.tsx y de docs/GUIA-*.md citan esos números.
 */

const PIN = 'Felipebolano2026';
const OUT = 'public/guia';

const audio = (name = 'perez_ana_ejercicio3.wav') => {
  const sr = 48000;
  const channel = Float32Array.from({ length: sr * 60 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / sr) * 0.1);
  return { name, mimeType: 'audio/wav', buffer: Buffer.from(encodeWav16([channel], sr)) };
};

/** Corpus entrenable de ejemplo: 24 muestras, 12 orígenes, filtros separable por espectro. */
const corpus = () => {
  const base = extractFeatures(decodePcm(encodeWav16([new Float32Array(4800)], 48000))!);
  return Array.from({ length: 24 }, (_, i) => {
    const positive = i % 2 === 0;
    const r = createReview(i.toString(16).padStart(64, '0'), `campana-${Math.floor(i / 2) + 1}-${positive ? 'filtrada' : 'original'}.wav`, { ...base, spectrum: { ...base.spectrum, flatness: positive ? 0.9 : 0.1, centroidHz: positive ? 6000 : 200, ltas: base.spectrum.ltas.map((b, j) => ({ ...b, db: positive ? -j : j - 48 })) } });
    r.sourceGroup = `campana-${Math.floor(i / 2) + 1}`;
    r.labels.filtros = positive ? 'present' : 'absent';
    return r;
  });
};

interface Mark { target: Locator; n?: number; note?: string }

/** Señala en pantalla y captura. La capa se borra después para no contaminar la siguiente captura. */
const shoot = async (page: Page, name: string, marks: Mark[]) => {
  // Un aviso arrastrado del paso anterior no es parte de la captura.
  const notice = page.locator('.notice-banner button');
  if (await notice.count()) await notice.first().click();
  if (marks.length) { await marks[0].target.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -56)); }
  await page.waitForTimeout(250); // deja asentar el scroll y las transiciones antes de medir
  const boxes: { x: number; y: number; width: number; height: number; n?: number; note?: string }[] = [];
  for (const m of marks) {
    const box = await m.target.boundingBox();
    if (box) boxes.push({ ...box, n: m.n, note: m.note });
  }
  await page.evaluate((items) => {
    document.querySelectorAll('.guia-overlay').forEach((e) => e.remove());
    const layer = document.createElement('div');
    layer.className = 'guia-overlay';
    Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '99999' });
    const AMBER = '#ffb74d', INK = '#1a1f16';
    for (const b of items) {
      const box = document.createElement('div');
      Object.assign(box.style, { position: 'absolute', left: `${b.x - 6}px`, top: `${b.y - 6}px`, width: `${b.width + 12}px`, height: `${b.height + 12}px`, border: `3px solid ${AMBER}`, borderRadius: '8px', boxShadow: '0 0 0 4px rgba(0,0,0,.35)' });
      layer.appendChild(box);
      if (b.n) {
        const badge = document.createElement('div');
        badge.textContent = String(b.n);
        Object.assign(badge.style, { position: 'absolute', left: `${b.x - 20}px`, top: `${b.y - 20}px`, width: '36px', height: '36px', borderRadius: '50%', background: AMBER, color: INK, font: '700 19px/36px system-ui, sans-serif', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.6)' });
        layer.appendChild(badge);
      }
    }
    // Las notas van a una leyenda fija, no bajo cada zona: dos zonas seguidas se tapaban la nota.
    const notes = items.filter((b) => b.note);
    if (notes.length) {
      const legend = document.createElement('div');
      Object.assign(legend.style, { position: 'absolute', visibility: 'hidden', maxWidth: '440px', padding: '12px 14px', background: 'rgba(26,31,22,.94)', border: `2px solid ${AMBER}`, borderRadius: '8px', color: '#f2f0e6', font: '500 14px/1.45 system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,.6)' });
      for (const b of notes) {
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', gap: '10px', alignItems: 'flex-start', margin: '4px 0' });
        const dot = document.createElement('span');
        dot.textContent = b.n ? String(b.n) : '•';
        Object.assign(dot.style, { flex: '0 0 24px', height: '24px', borderRadius: '50%', background: AMBER, color: INK, font: '700 14px/24px system-ui, sans-serif', textAlign: 'center' });
        const text = document.createElement('span');
        text.textContent = b.note ?? '';
        row.appendChild(dot); row.appendChild(text); legend.appendChild(row);
      }
      layer.appendChild(legend);
      document.body.appendChild(layer);
      const W = window.innerWidth, H = window.innerHeight, lw = legend.offsetWidth, lh = legend.offsetHeight, M = 18;
      const corners = [{ x: W - lw - M, y: H - lh - M }, { x: W - lw - M, y: M }, { x: M, y: H - lh - M }, { x: M, y: M }];
      const overlap = (c: { x: number; y: number }) => items.reduce((acc, b) => acc + Math.max(0, Math.min(c.x + lw, b.x + b.width) - Math.max(c.x, b.x)) * Math.max(0, Math.min(c.y + lh, b.y + b.height) - Math.max(c.y, b.y)), 0);
      const best = corners.map((c) => ({ c, o: overlap(c) })).sort((a, b) => a.o - b.o)[0].c;
      Object.assign(legend.style, { left: `${best.x}px`, top: `${best.y}px`, visibility: 'visible' });
      return;
    }
    document.body.appendChild(layer);
  }, boxes);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.evaluate(() => document.querySelectorAll('.guia-overlay').forEach((e) => e.remove()));
};

const salir = (page: Page) => page.getByRole('button', { name: /Salir/ }).click();
const entrarProfesor = async (page: Page) => { await page.getByLabel('PIN', { exact: true }).fill(PIN); await page.getByRole('button', { name: 'Entrar como profesor' }).click(); };
const entrarEstudiante = async (page: Page, nombre: string) => { await page.getByLabel('Nombre y apellidos').fill(nombre); await page.getByRole('button', { name: 'Entrar como estudiante' }).click(); };
const guardado = (page: Page) => expect(page.locator('.workspace-topline')).not.toContainText('Guardando cambios');
const abrir = async (page: Page, nombre: RegExp) => { await page.getByRole('button', { name: /Biblioteca|Mis entregas/ }).first().click(); await page.getByRole('button', { name: nombre }).click(); await expect(page.locator('.analysis-progress')).toHaveCount(0); };

test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/'); });

test('capturas del profesor', async ({ page }) => {
  // 01 · Entrada
  await expect(page.getByRole('heading', { name: '¿Quién entra?' })).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill(PIN);
  await shoot(page, 'profesor-01-entrada', [
    { target: page.getByLabel('PIN', { exact: true }), n: 1, note: 'El PIN acordado para tu grupo' },
    { target: page.getByRole('button', { name: 'Entrar como profesor' }), n: 2 },
  ]);
  await page.getByRole('button', { name: 'Entrar como profesor' }).click();

  // 02 · Laboratorio
  await expect(page.getByRole('heading', { name: /Escucha\./ })).toBeVisible();
  await shoot(page, 'profesor-02-laboratorio', [
    { target: page.locator('.drop-zone'), n: 1, note: 'Arrastra WAV, AIFF o FLAC, uno o varios' },
    { target: page.locator('.demo-grid'), n: 2, note: 'Ejemplos sintéticos para practicar; no entrenan' },
  ]);

  // 03 · Mediciones, con la demo de clics
  await page.getByRole('button', { name: /Edición con clics/ }).click();
  await expect(page.getByRole('heading', { name: 'campana_cortes.wav', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '200 px/s' })).toBeVisible();
  await shoot(page, 'profesor-03-mediciones', [
    { target: page.locator('.metric-grid'), n: 1, note: 'Medido en el archivo: sonoridad, pico real, saturación, clics' },
    { target: page.locator('.signal-panel'), n: 2, note: 'Forma de onda con las marcas medidas; pulsa una para escucharla' },
  ]);
  await shoot(page, 'profesor-03b-evidencias', [
    { target: page.locator('.evidence-panel'), n: 1, note: 'Cada punto con su momento y su fuente: medido, profesor o modelo' },
  ]);

  // 05 · Marcar sobre la onda
  await page.getByLabel('Herramienta que vas a marcar').selectOption('reversa');
  await page.getByRole('button', { name: 'Marcar', exact: true }).click();
  await page.getByRole('button', { name: '200 px/s' }).click();
  await page.getByRole('button', { name: 'Marcar desde el tiempo actual' }).click();
  await page.getByLabel('Final de la marca de Reversa').fill('4.5');
  await page.getByLabel('Comentario de la marca de Reversa').fill('Cola invertida antes del cambio');
  await guardado(page);
  await shoot(page, 'profesor-05-marcar', [
    { target: page.locator('.zoom-row'), n: 1, note: 'Sube el zoom para marcar con precisión' },
    { target: page.locator('.mark-toolbar'), n: 2, note: 'Elige la herramienta; con «Marcando…» activo, arrastra sobre la onda' },
    { target: page.locator('.mark-list'), n: 3, note: 'Cada marca: inicio, fin, comentario, escuchar y borrar' },
  ]);

  // 04 · Revisar y calificar
  await page.getByRole('group', { name: 'Revisión de Pitch shift' }).getByRole('button', { name: 'Presente' }).click();
  await page.getByRole('group', { name: 'Revisión de Filtros' }).getByRole('button', { name: 'Ausente' }).click();
  await page.getByLabel('Evidencia de Filtros').fill('El espectro coincide con la fuente; no hay barrido.');
  await guardado(page);
  await shoot(page, 'profesor-04-revisar', [
    { target: page.locator('.effect-list'), n: 1, note: 'Presente, ausente o pendiente por herramienta, con su evidencia' },
    { target: page.locator('.score-panel'), n: 2, note: 'La nota se calcula con la rúbrica; pendiente = nota abierta' },
  ]);

  // Entrega de una estudiante, para publicar y ver la deriva
  await salir(page);
  await entrarEstudiante(page, 'Ana Pérez');
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.locator('.file-heading')).toContainText('Tu entrega');
  await page.getByLabel('Sinopsis de la pieza').fill('Paisaje sonoro construido a partir de una campana grabada en el patio; reversa en 0:12–0:18 y un loop de dos compases al final.');
  await guardado(page);
  await salir(page);
  await entrarProfesor(page);
  await abrir(page, /^perez_ana_ejercicio3/);
  for (const tool of ['Pitch shift', 'Time stretch', 'Reversa', 'Filtros', 'Loops']) await page.getByRole('group', { name: `Revisión de ${tool}` }).getByRole('button', { name: 'Presente' }).click();
  await page.getByLabel('Sobreprocesamiento').selectOption('none');
  await page.getByLabel('Efectos extra').selectOption('absent');
  await page.getByLabel('Feedback para el estudiante').fill('Muy buen control de nivel y una reversa bien colocada. Para la siguiente entrega, cuida los cortes del loop: se oyen dos clics en 0:41.');
  await page.getByRole('button', { name: 'Publicar al estudiante' }).click();
  await expect(page.getByRole('button', { name: 'Retirar publicación' })).toBeVisible();
  await guardado(page);

  // 08 · Rúbrica con formato de nombre exigido (y cambio que produce deriva)
  await page.getByRole('button', { name: /Rúbrica/ }).click();
  await page.getByLabel('Formato exigido del nombre de archivo').fill('{estudiante}_{estudiante}_ejercicio{numero}');
  await page.getByLabel('Probar un nombre').fill('perez_ana_ejercicio3.wav');
  await page.getByLabel('Como si lo entregara').fill('Ana Pérez');
  await expect(page.getByTestId('name-verdict')).toContainText('Puntuaría');
  await shoot(page, 'profesor-08-rubrica', [
    { target: page.getByLabel('Formato exigido del nombre de archivo'), n: 1, note: 'Escríbelo como en el enunciado' },
    { target: page.locator('.name-test'), n: 2, note: 'Prueba un nombre antes de guardar' },
    { target: page.getByRole('button', { name: 'Guardar rúbrica' }), n: 3 },
  ]);
  await page.getByLabel('Puntos por nombre de archivo').fill('0');
  await page.getByRole('button', { name: 'Guardar rúbrica' }).click();
  await expect(page.locator('.notice-banner')).toContainText('Rúbrica guardada');

  // 07 · Publicar: la nota congelada y la deriva
  await abrir(page, /^perez_ana_ejercicio3/);
  await expect(page.getByTestId('grade-drift')).toBeVisible();
  await shoot(page, 'profesor-07-publicar', [
    { target: page.getByTestId('grade-drift'), n: 1, note: 'La nota publicada no se mueve; tú ves la diferencia y decides' },
    { target: page.getByRole('button', { name: 'Retirar publicación' }), n: 2 },
  ]);
  await page.locator('.score-panel').scrollIntoViewIfNeeded();
  await shoot(page, 'profesor-07b-nota', [
    { target: page.locator('.publish-state'), n: 1, note: 'Lo que ve el estudiante desde que publicaste' },
    { target: page.getByLabel('Feedback para el estudiante'), n: 2, note: '«Redactar borrador» te da un texto para editar' },
  ]);

  // 09 · Modelo local: corpus de ejemplo, conjunto congelado, entrenamiento
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByLabel('Importar colección JSON').setInputFiles({ name: 'corpus-ejemplo.json', mimeType: 'application/json', buffer: Buffer.from(exportDataset(corpus())) });
  await expect(page.locator('.notice-banner')).toContainText('24 registros importados');
  await page.getByRole('button', { name: /Modelo local/ }).click();
  await page.getByRole('button', { name: 'Congelar conjunto de evaluación' }).click();
  await expect(page.getByTestId('holdout-panel')).toContainText('4 muestras de 2 orígenes');
  await shoot(page, 'profesor-09-modelo', [
    { target: page.locator('.learning-status'), n: 1, note: 'Cuántas muestras reales y orígenes hay, y qué herramientas pueden entrenar' },
    { target: page.getByTestId('holdout-panel'), n: 2, note: 'Congela antes del primer entrenamiento: el mismo examen para todos los modelos' },
    { target: page.locator('.readiness-table'), n: 3, note: 'Mínimo por herramienta: 12 muestras, 6 orígenes, ambas clases' },
  ]);
  await page.getByRole('button', { name: 'Entrenar modelo local', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lo que dicen los datos retenidos.' })).toBeVisible();
  await shoot(page, 'profesor-09b-validacion', [
    { target: page.locator('.learning-view .library-table-wrap').first(), n: 1, note: '«Congelado» es la cifra comparable entre entrenamientos' },
  ]);

  // 10 · Biblioteca
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await shoot(page, 'profesor-10-biblioteca', [
    { target: page.locator('.library-tools'), n: 1, note: 'Buscar, filtrar, importar y exportar (JSON para la colección, CSV para la hoja de notas)' },
    { target: page.locator('.library-table-wrap'), n: 2, note: 'Estado de cada muestra: etiquetas, nota, publicada o no' },
  ]);
});

test('capturas del estudiante', async ({ page }) => {
  // El profesor fija el formato de nombre para que la estudiante lo vea antes de entregar
  await entrarProfesor(page);
  await page.getByRole('button', { name: /Rúbrica/ }).click();
  await page.getByLabel('Formato exigido del nombre de archivo').fill('{estudiante}_{estudiante}_ejercicio{numero}');
  await page.getByRole('button', { name: 'Guardar rúbrica' }).click();
  await expect(page.locator('.notice-banner')).toContainText('Rúbrica guardada');
  await salir(page);

  // 01 · Entrada
  await page.getByLabel('Nombre y apellidos').fill('Ana Pérez');
  await shoot(page, 'estudiante-01-entrada', [
    { target: page.getByLabel('Nombre y apellidos'), n: 1, note: 'Siempre el mismo nombre: con él se identifican tus entregas' },
    { target: page.getByRole('button', { name: 'Entrar como estudiante' }), n: 2 },
  ]);
  await page.getByRole('button', { name: 'Entrar como estudiante' }).click();

  // 02 · Preparar: el formato exigido, visible antes de subir
  await expect(page.getByTestId('name-requirement')).toBeVisible();
  await shoot(page, 'estudiante-02-preparar', [
    { target: page.getByTestId('name-requirement'), n: 1, note: 'Nombra el archivo así; el ejemplo lleva tu nombre' },
    { target: page.locator('.drop-zone'), n: 2, note: 'WAV, AIFF o FLAC (no MP3), hasta 200 MB' },
  ]);

  // 03 · Entregar y 04 · Sinopsis
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.locator('.file-heading')).toContainText('Tu entrega');
  await shoot(page, 'estudiante-03-entregar', [
    { target: page.locator('.file-heading'), n: 1, note: 'Tu entrega queda registrada a tu nombre, con fecha' },
    { target: page.locator('.metric-grid'), n: 2, note: 'Las mediciones se hacen en tu navegador' },
  ]);
  await page.getByLabel('Sinopsis de la pieza').fill('Paisaje sonoro construido a partir de una campana grabada en el patio; reversa en 0:12–0:18 y un loop de dos compases al final.');
  await guardado(page);
  await shoot(page, 'estudiante-04-sinopsis', [
    { target: page.getByLabel('Sinopsis de la pieza'), n: 1, note: 'Qué querías conseguir y dónde usaste cada proceso, con tiempos' },
  ]);

  // 05 · Mediciones
  await shoot(page, 'estudiante-05-mediciones', [
    { target: page.locator('.signal-panel'), n: 1, note: 'Pulsa una marca para escuchar justo ese momento' },
    { target: page.locator('.evidence-panel'), n: 2, note: 'Lo medido en tu archivo; lo del profesor aparece al publicar' },
  ]);

  // El profesor califica y publica
  await salir(page);
  await entrarProfesor(page);
  await abrir(page, /^perez_ana_ejercicio3/);
  for (const tool of ['Pitch shift', 'Time stretch', 'Reversa', 'Filtros', 'Loops']) await page.getByRole('group', { name: `Revisión de ${tool}` }).getByRole('button', { name: 'Presente' }).click();
  await page.getByLabel('Sobreprocesamiento').selectOption('none');
  await page.getByLabel('Efectos extra').selectOption('absent');
  await page.getByLabel('Feedback para el estudiante').fill('Muy buen control de nivel y una reversa bien colocada. Para la siguiente entrega, cuida los cortes del loop: se oyen dos clics en 0:41.');
  await page.getByRole('button', { name: 'Publicar al estudiante' }).click();
  await expect(page.getByRole('button', { name: 'Retirar publicación' })).toBeVisible();
  await guardado(page);
  await salir(page);

  // 07 · Calificación publicada
  await entrarEstudiante(page, 'Ana Pérez');
  await page.getByRole('button', { name: /Mis entregas/ }).first().click();
  await expect(page.locator('tbody tr')).toContainText('Calificado');
  await shoot(page, 'estudiante-07-entregas', [
    { target: page.locator('.library-table-wrap'), n: 1, note: '«Calificado» cuando el profesor publica; antes, «En revisión»' },
  ]);
  await page.getByRole('button', { name: /^perez_ana_ejercicio3/ }).click();
  await expect(page.getByTestId('student-score')).toBeVisible();
  await shoot(page, 'estudiante-07-calificacion', [
    { target: page.locator('.student-status'), n: 1, note: 'La nota publicada, su desglose y los comentarios del profesor' },
  ]);
});
