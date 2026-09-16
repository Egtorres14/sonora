/**
 * EXPERIMENTO. No forma parte de la aplicación ni de su build.
 *
 * Pregunta: para los efectos que ocurren en un tramo (reversa por segmentos, loops), ¿entrenar con
 * ventanas etiquetadas supera a entrenar con una fila por archivo, que es lo que hace hoy el modelo
 * local (services/learning/descriptors.ts describe el archivo entero)?
 *
 * Método: se regeneran variantes a partir de las grabaciones reales de corpus/sources/files
 * aplicando los efectos en tramos EXACTOS, conocidos por construcción y no estimados. Se entrena el
 * mismo bosque que la aplicación (DEFAULT_FOREST) en las dos modalidades y se valida con particiones
 * separadas por grabación de origen: ninguna ventana de un archivo de prueba se ha visto al entrenar.
 *
 *   npx tsx scripts/experiments/segment-vs-file.ts [--sources 50] [--window 2] [--hop 1] [--clip 20]
 */
import fs from 'node:fs';
import path from 'node:path';
import decode from 'audio-decode';
import { RandomForestClassifier } from 'ml-random-forest';
import { decodePcm } from '../../services/audio/wav';
import { extractFeatures } from '../../services/audio/features';
import { downmixMono } from '../../services/audio/dsp';
import { describeAudio } from '../../services/learning/descriptors';
import { DEFAULT_FOREST } from '../../services/learning/model';
import { mulberry32, hashSeed, pick, uniform, normalizePeak, trimTo, timeStretch, pitchShift, reverseSegments, filterSweep, insertLoop, reverb } from '../corpus/dsp-effects';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = Number(process.argv[i + 1]);
  // Un argumento sin valor daba NaN y el barrido de ventanas se quedaba en una por archivo.
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} necesita un número positivo.`);
  return value;
};
const N_SOURCES = arg('sources', 50), WINDOW = arg('window', 2), HOP = arg('hop', 1), CLIP = arg('clip', 20), SEED = 1;
/** Fracción de la ventana dentro del tramo para contarla como positiva. */
const POSITIVE_RATIO = 0.5;
/** Zona gris: ni positiva ni negativa. Se descarta al entrenar y al medir. */
const AMBIGUOUS_RATIO = 0.15;

type Effect = 'reversa' | 'loops';
interface Range { start: number; end: number }
interface Variant { source: string; name: string; audio: Float32Array; fs: number; truth: Record<Effect, Range[]>; present: Record<Effect, boolean> }

const secs = (samples: number, fs: number) => samples / fs;

const buildVariants = (id: string, x: Float32Array, fs: number): Variant[] => {
  const rng = mulberry32(hashSeed(id) ^ SEED);
  const out: Variant[] = [];
  const make = (name: string, audio: Float32Array, truth: Partial<Record<Effect, Range[]>>): Variant => ({
    source: id, name, audio, fs,
    truth: { reversa: truth.reversa ?? [], loops: truth.loops ?? [] },
    present: { reversa: !!truth.reversa?.length, loops: !!truth.loops?.length },
  });

  out.push(make('original', x, {}));

  // Reversa por segmentos: se invierten tramos concretos y se guardan sus límites.
  for (let k = 0; k < 2; k++) {
    const segs: { start: number; end: number }[] = [];
    for (let i = 0, n = 2 + Math.floor(rng() * 2); i < n; i++) {
      const len = Math.floor(uniform(rng, 1.2, 3) * fs);
      const start = Math.floor(uniform(rng, 0, Math.max(1, x.length - len)));
      segs.push({ start, end: Math.min(x.length, start + len) });
    }
    out.push(make(`reversa-${k + 1}`, reverseSegments(x, segs), { reversa: segs.map(s => ({ start: secs(s.start, fs), end: secs(s.end, fs) })) }));
  }

  // Loop: se repite un segmento desde una posición; el tramo afectado se conoce exactamente.
  for (let k = 0; k < 2; k++) {
    const length = Math.floor(uniform(rng, 0.4, 1.6) * fs);
    const start = Math.floor(uniform(rng, 0, Math.max(1, x.length - length * 2)));
    const repeats = 3 + Math.floor(rng() * 5);
    const crossfade = rng() < 0.5 ? Math.floor(0.02 * fs) : 0;
    const at = Math.floor(uniform(rng, 0, Math.max(1, x.length - length)));
    const cf = Math.min(crossfade, Math.floor(length / 2));
    const loopLen = (length - cf) * repeats + cf;
    out.push(make(`loop-${k + 1}`, insertLoop(x, { start, length, repeats, at, crossfade }), { loops: [{ start: secs(at, fs), end: secs(Math.min(x.length, at + loopLen), fs) }] }));
  }

  // Negativos difíciles: muy procesados, pero sin reversa ni loops.
  const nyq = fs / 2;
  out.push(make('pitch', pitchShift(x, fs, pick(rng, [-7, -4, 4, 7])), {}));
  out.push(make('stretch', timeStretch(x, pick(rng, [0.5, 0.75, 1.5, 2])), {}));
  out.push(make('filtro', filterSweep(x, fs, 'lowpass', uniform(rng, 4000, Math.min(12000, nyq * 0.8)), uniform(rng, 150, 600), 0.9), {}));
  out.push(make('reverb', reverb(x, fs, { roomSec: 1.8, mix: 0.35 }), {}));
  return out;
};

const featuresOf = (x: Float32Array, fs: number) => extractFeatures({
  sampleRate: fs, bitDepth: 16, sampleFormat: 'int', channels: [x], length: x.length,
  duration: x.length / fs, container: 'wav', decoder: 'native-pcm',
});

interface Row { source: string; file: string; vector: number[]; label: 0 | 1 }
const overlap = (a: Range, b: Range) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

const rowsFor = (v: Variant, effect: Effect) => {
  const file: Row[] = [], windows: Row[] = [];
  const key = `${v.source}__${v.name}`;
  try { file.push({ source: v.source, file: key, vector: describeAudio(featuresOf(v.audio, v.fs)), label: v.present[effect] ? 1 : 0 }); }
  catch { return { file, windows }; }

  const size = Math.round(WINDOW * v.fs), hop = Math.round(HOP * v.fs);
  for (let at = 0; at + size <= v.audio.length; at += hop) {
    const range: Range = { start: secs(at, v.fs), end: secs(at + size, v.fs) };
    const covered = v.truth[effect].reduce((acc, t) => acc + overlap(range, t), 0) / WINDOW;
    if (covered > AMBIGUOUS_RATIO && covered < POSITIVE_RATIO) continue;
    try { windows.push({ source: v.source, file: key, vector: describeAudio(featuresOf(v.audio.slice(at, at + size), v.fs)), label: covered >= POSITIVE_RATIO ? 1 : 0 }); }
    catch { /* ventana inservible (silencio total): se omite */ }
  }
  return { file, windows };
};

/** Mismo equilibrado de clases que la aplicación: se repite la clase minoritaria. */
const balance = (rows: Row[]) => {
  const pos = rows.filter(r => r.label === 1), neg = rows.filter(r => r.label === 0);
  if (!pos.length || !neg.length) return rows;
  const [minor, major] = pos.length <= neg.length ? [pos, neg] : [neg, pos];
  const out = [...rows];
  for (let i = minor.length; i < major.length; i++) out.push(minor[i % minor.length]);
  return out;
};

const train = (rows: Row[]) => {
  const c = new RandomForestClassifier({ seed: 42, maxFeatures: DEFAULT_FOREST.maxFeatures, replacement: false, nEstimators: DEFAULT_FOREST.nEstimators, useSampleBagging: true, noOOB: true, treeOptions: { maxDepth: DEFAULT_FOREST.maxDepth, minNumSamples: DEFAULT_FOREST.minNumSamples } });
  const b = balance(rows);
  c.train(b.map(r => r.vector), b.map(r => r.label));
  return c;
};

interface Counts { tp: number; tn: number; fp: number; fn: number }
const empty = (): Counts => ({ tp: 0, tn: 0, fp: 0, fn: 0 });
const add = (c: Counts, actual: number, predicted: number) => { c[actual === 1 ? (predicted === 1 ? 'tp' : 'fn') : (predicted === 1 ? 'fp' : 'tn')]++; };
const recall = (c: Counts) => (c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0);
const specificity = (c: Counts) => (c.tn + c.fp ? c.tn / (c.tn + c.fp) : 0);
const precision = (c: Counts) => (c.tp + c.fp ? c.tp / (c.tp + c.fp) : 0);
const balancedAccuracy = (c: Counts) => (recall(c) + specificity(c)) / 2;
const pct = (x: number) => `${(x * 100).toFixed(0)} %`;

const folds = (sources: string[], k = 3) => {
  const sorted = [...sources].sort();
  return Array.from({ length: k }, (_, i) => new Set(sorted.filter((_, j) => j % k === i)));
};

const ROOT = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'corpus/sources/manifest.json'), 'utf8')) as { id: string; file: string }[];
console.log(`Fuentes: ${Math.min(N_SOURCES, manifest.length)} de ${manifest.length} · ventana ${WINDOW} s · salto ${HOP} s · recorte ${CLIP} s\n`);

const variants: Variant[] = [];
const t0 = Date.now();
for (const entry of manifest.slice(0, N_SOURCES)) {
  const file = path.join(ROOT, 'corpus/sources/files', entry.file);
  if (!fs.existsSync(file)) { console.warn(`  ✗ ${entry.id}: no está en disco`); continue; }
  try {
    const buf = fs.readFileSync(file);
    const pcm = /\.(wav|wave|aif|aiff)$/i.test(file) ? decodePcm(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) : null;
    let mono: Float32Array, sr: number;
    if (pcm) { mono = downmixMono(pcm.channels); sr = pcm.sampleRate; }
    else { const ab = await decode(new Uint8Array(buf)); mono = downmixMono(ab.channelData.map(c => Float32Array.from(c))); sr = ab.sampleRate; }
    variants.push(...buildVariants(entry.id, normalizePeak(trimTo(mono, sr, CLIP), -3), sr));
  } catch (e) { console.warn(`  ✗ ${entry.id}: ${(e as Error).message}`); }
}
console.log(`Variantes generadas: ${variants.length} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);

for (const effect of ['reversa', 'loops'] as Effect[]) {
  const t1 = Date.now();
  const fileRows: Row[] = [], windowRows: Row[] = [];
  for (const v of variants) { const r = rowsFor(v, effect); fileRows.push(...r.file); windowRows.push(...r.windows); }
  const sources = [...new Set(fileRows.map(r => r.source))];

  const byFile = empty(), byWindowFile = empty(), byWindow = empty();
  for (const test of folds(sources)) {
    const trainFiles = fileRows.filter(r => !test.has(r.source)), testFiles = fileRows.filter(r => test.has(r.source));
    const trainWin = windowRows.filter(r => !test.has(r.source)), testWin = windowRows.filter(r => test.has(r.source));
    if (!trainFiles.some(r => r.label === 1) || !trainFiles.some(r => r.label === 0)) continue;

    const fileModel = train(trainFiles);
    fileModel.predict(testFiles.map(r => r.vector)).forEach((p, i) => add(byFile, testFiles[i].label, p));

    const winModel = train(trainWin);
    const winPred = winModel.predict(testWin.map(r => r.vector));
    winPred.forEach((p, i) => add(byWindow, testWin[i].label, p));

    // Decisión por archivo del modelo por ventanas: positivo si al menos dos ventanas lo son.
    const perFile = new Map<string, { actual: number; positives: number }>();
    testWin.forEach((r, i) => {
      const e = perFile.get(r.file) ?? { actual: 0, positives: 0 };
      e.actual = Math.max(e.actual, r.label); e.positives += winPred[i] === 1 ? 1 : 0;
      perFile.set(r.file, e);
    });
    for (const e of perFile.values()) add(byWindowFile, e.actual, e.positives >= 2 ? 1 : 0);
  }

  const positives = windowRows.filter(r => r.label === 1).length;
  console.log(`━━━ ${effect.toUpperCase()} ━━━  ${fileRows.length} archivos · ${windowRows.length} ventanas (${positives} positivas) · ${((Date.now() - t1) / 1000).toFixed(0)} s`);
  const show = (label: string, c: Counts) => console.log(`  ${label.padEnd(32)} exactitud eq. ${pct(balancedAccuracy(c)).padStart(5)} · sensib. ${pct(recall(c)).padStart(5)} · precis. ${pct(precision(c)).padStart(5)} · VP/VN/FP/FN ${c.tp}/${c.tn}/${c.fp}/${c.fn}`);
  show('Por archivo (modelo actual)', byFile);
  show('Por ventanas → decide archivo', byWindowFile);
  show('Por ventanas → localización', byWindow);
  console.log();
}
