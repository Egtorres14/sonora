/**
 * Construye el corpus de entrenamiento a partir de grabaciones fuente.
 *
 *   npx tsx scripts/corpus/build-corpus.ts --sources corpus/sources --out corpus [--clip 20] [--seed 1] [--wav all|none]
 *   npx tsx scripts/corpus/build-corpus.ts --synthetic --out corpus-sintetico     (prueba del generador)
 *
 * Por cada fuente (un grupo de origen) genera variantes con etiquetas exactas por construcción:
 * original, una por herramienta, combinaciones y distractores. Extrae las características con el
 * mismo DSP de la aplicación y escribe `coleccion.json` (importable en Biblioteca) y los WAV.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadLame } from './lame';
import { resampleMonoLinear } from './dsp-effects';
import decode from 'audio-decode';
import { encodeWav16, decodePcm } from '../../services/audio/wav';
import { extractFeatures } from '../../services/audio/features';
import { downmixMono } from '../../services/audio/dsp';
import { createReview, type ReviewRecord } from '../../services/review';
import { DatasetSchema } from '../../services/library-schema';
import type { ToolId } from '../../services/scoring/rubric';
import {
  mulberry32, hashSeed, pick, uniform, normalizePeak, trimTo, timeStretch, pitchShift, reverseWhole, reverseSegments,
  filterSweep, filterLfo, lowpass, highpass, insertLoop, reverb, delay, saturate, tremolo, addNoise, gainDb, synthSource, type Rng,
} from './dsp-effects';

interface SourceEntry { id: string; file: string; category: string; description: string; license: string; attribution: string; sourceUrl: string }
interface Args { sources: string; out: string; clip: number; seed: number; wav: 'all' | 'none'; synthetic: boolean; maxSources: number; wavMax: number; mp3: boolean; mp3Seconds: number; perTool: number }

const parseArgs = (): Args => {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => { const i = a.indexOf(`--${k}`); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
  return { sources: get('sources', 'corpus/sources'), out: get('out', 'corpus'), clip: Number(get('clip', '20')), seed: Number(get('seed', '1')), wav: get('wav', 'all') as Args['wav'], synthetic: a.includes('--synthetic'), maxSources: Number(get('max', '9999')), wavMax: Number(get('wav-max', '15')), mp3: a.includes('--mp3'), mp3Seconds: Number(get('mp3-seconds', '12')), perTool: Number(get('per-tool', '2')) };
};

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`;
const TOOLS: ToolId[] = ['pitch_shift', 'time_stretch', 'reversa', 'filtros', 'loops'];

type Labels = Record<ToolId, 'present' | 'absent'>;
interface Variant { name: string; audio: Float32Array; labels: Labels; evidence: Record<ToolId, string>; extra: 'present' | 'absent'; overprocessing: ReviewRecord['overprocessing']; chain: string[] }

const blank = (): { labels: Labels; evidence: Record<ToolId, string> } => ({
  labels: { pitch_shift: 'absent', time_stretch: 'absent', reversa: 'absent', filtros: 'absent', loops: 'absent' },
  evidence: { pitch_shift: 'No aplicado (corpus generado).', time_stretch: 'No aplicado (corpus generado).', reversa: 'No aplicado (corpus generado).', filtros: 'No aplicado (corpus generado).', loops: 'No aplicado (corpus generado).' },
});

// --- Operaciones etiquetadas ------------------------------------------------

type Op = (x: Float32Array, fs: number, rng: Rng, v: Variant) => Float32Array;

const opPitch: Op = (x, fs, rng, v) => {
  const semis = pick(rng, [-12, -7, -5, -3, 3, 4, 5, 7, 12]);
  v.labels.pitch_shift = 'present';
  v.evidence.pitch_shift = `${semis > 0 ? '+' : ''}${semis} semitonos en todo el archivo (phase vocoder 2048/512 + remuestreo lineal).`;
  v.chain.push(`pitch${semis > 0 ? '+' : ''}${semis}`);
  if (Math.abs(semis) >= 12) v.overprocessing = 'Leve';
  return pitchShift(x, fs, semis);
};

const opStretch: Op = (x, fs, rng, v) => {
  const factor = pick(rng, [0.5, 0.66, 0.8, 1.25, 1.5, 2.0, 3.0]);
  v.labels.time_stretch = 'present';
  v.evidence.time_stretch = `Factor ×${factor} en todo el archivo (phase vocoder 2048/512); duración ${fmt(x.length / fs)} → ${fmt((x.length * factor) / fs)}.`;
  v.chain.push(`stretch×${factor}`);
  if (factor >= 3 || factor <= 0.5) v.overprocessing = 'Moderado';
  return timeStretch(x, factor);
};

const opReverse: Op = (x, fs, rng, v) => {
  const mode = pick(rng, ['whole', 'segments', 'reverse-reverb'] as const);
  v.labels.reversa = 'present';
  if (mode === 'whole') { v.evidence.reversa = 'Archivo completo invertido.'; v.chain.push('reverse'); return reverseWhole(x); }
  if (mode === 'reverse-reverb') {
    v.evidence.reversa = 'Reverb (1.8 s) y después inversión completa ("reverse reverb").'; v.chain.push('reverse-reverb'); v.extra = 'present';
    return reverseWhole(reverb(x, fs, { roomSec: 1.8, mix: 0.5, tailSec: 1.8 }));
  }
  const count = pick(rng, [1, 2, 3]);
  const segs: { start: number; end: number }[] = [];
  for (let i = 0; i < count; i++) { const len = Math.round(uniform(rng, 1.5, 5) * fs); const start = Math.round(uniform(rng, 0, Math.max(0, x.length - len))); segs.push({ start, end: Math.min(x.length, start + len) }); }
  v.evidence.reversa = `Segmentos invertidos: ${segs.map((s) => `${fmt(s.start / fs)}–${fmt(s.end / fs)}`).join(', ')}.`;
  v.chain.push(`reverse-seg${count}`);
  return reverseSegments(x, segs);
};

const opFilter: Op = (x, fs, rng, v) => {
  const kind = pick(rng, ['lp-sweep', 'hp-sweep', 'bp-sweep', 'lp-static', 'hp-static', 'lfo'] as const);
  const Q = pick(rng, [0.7, 1.5, 3, 6]);
  v.labels.filtros = 'present';
  v.chain.push(kind);
  const nyq = fs / 2;
  if (kind === 'lp-sweep') { const a = uniform(rng, 4000, Math.min(12000, nyq * 0.8)), b = uniform(rng, 150, 600); v.evidence.filtros = `Paso bajo con barrido ${a.toFixed(0)} → ${b.toFixed(0)} Hz, Q ${Q}, todo el archivo.`; return filterSweep(x, fs, 'lowpass', a, b, Q); }
  if (kind === 'hp-sweep') { const a = uniform(rng, 80, 300), b = uniform(rng, 2000, 6000); v.evidence.filtros = `Paso alto con barrido ${a.toFixed(0)} → ${b.toFixed(0)} Hz, Q ${Q}, todo el archivo.`; return filterSweep(x, fs, 'highpass', a, b, Q); }
  if (kind === 'bp-sweep') { const a = uniform(rng, 200, 500), b = uniform(rng, 2500, 6000); v.evidence.filtros = `Paso banda con barrido ${a.toFixed(0)} → ${b.toFixed(0)} Hz, Q ${Math.max(Q, 1.5)}, todo el archivo.`; return normalizePeak(filterSweep(x, fs, 'bandpass', a, b, Math.max(Q, 1.5)), -3); }
  if (kind === 'lp-static') { const fc = uniform(rng, 300, 1500); v.evidence.filtros = `Paso bajo fijo a ${fc.toFixed(0)} Hz, Q ${Q}.`; return lowpass(x, fs, fc, Q); }
  if (kind === 'hp-static') { const fc = uniform(rng, 800, 3000); v.evidence.filtros = `Paso alto fijo a ${fc.toFixed(0)} Hz, Q ${Q}.`; return highpass(x, fs, fc, Q); }
  const rate = uniform(rng, 0.2, 2); const center = uniform(rng, 600, 2000);
  v.evidence.filtros = `Paso bajo modulado por LFO ${rate.toFixed(2)} Hz alrededor de ${center.toFixed(0)} Hz (±2 octavas), Q ${Q}.`;
  return filterLfo(x, fs, 'lowpass', center, 2, rate, Q);
};

const opLoop: Op = (x, fs, rng, v) => {
  const length = Math.round(uniform(rng, 0.2, 2.0) * fs);
  const start = Math.round(uniform(rng, 0, Math.max(0, x.length - length)));
  const repeats = pick(rng, [3, 4, 6, 8, 12]);
  const crossfade = pick(rng, [0, Math.round(0.01 * fs), Math.round(0.05 * fs)]);
  const at = Math.round(uniform(rng, 0, x.length * 0.6));
  v.labels.loops = 'present';
  v.evidence.loops = `Segmento ${fmt(start / fs)}–${fmt((start + length) / fs)} repetido ${repeats} veces desde ${fmt(at / fs)}${crossfade ? ` con crossfade de ${Math.round((crossfade / fs) * 1000)} ms` : ' con cortes secos'}.`;
  v.chain.push(`loop×${repeats}`);
  return insertLoop(x, { start, length, repeats, at, crossfade });
};

const opDistractor: Op = (x, fs, rng, v) => {
  const kind = pick(rng, ['reverb', 'delay', 'gain', 'saturate', 'tremolo', 'noise'] as const);
  v.chain.push(kind);
  if (kind === 'reverb') { v.extra = 'present'; return reverb(x, fs, { roomSec: uniform(rng, 0.8, 3), mix: uniform(rng, 0.2, 0.5) }); }
  if (kind === 'delay') { v.extra = 'present'; return delay(x, fs, { timeSec: pick(rng, [0.25, 0.375, 0.5]), feedback: uniform(rng, 0.2, 0.55), mix: uniform(rng, 0.25, 0.5) }); }
  if (kind === 'gain') return gainDb(x, pick(rng, [-12, -6, 6]));
  if (kind === 'saturate') { v.overprocessing = 'Leve'; return saturate(x, uniform(rng, 6, 18)); }
  if (kind === 'tremolo') { v.extra = 'present'; return tremolo(x, fs, uniform(rng, 2, 8), uniform(rng, 0.4, 0.9)); }
  return addNoise(x, rng, uniform(rng, -55, -40));
};

const OPS: Record<ToolId, Op> = { pitch_shift: opPitch, time_stretch: opStretch, reversa: opReverse, filtros: opFilter, loops: opLoop };

/** Plan de variantes por fuente: original, `perTool` por herramienta, 4 combinaciones, 3 distractores. */
const planVariants = (source: Float32Array, fs: number, rng: Rng, perTool = 2): Variant[] => {
  const make = (name: string, chain: (Op | 'none')[]): Variant => {
    const b = blank();
    const v: Variant = { name, audio: source, labels: b.labels, evidence: b.evidence, extra: 'absent', overprocessing: 'none', chain: [] };
    let y = source;
    for (const op of chain) if (op !== 'none') y = op(y, fs, rng, v);
    // pequeñas variaciones de nivel para que el nivel no sea una pista
    v.audio = normalizePeak(y, pick(rng, [-1, -3, -6, -9]));
    return v;
  };
  const variants: Variant[] = [make('original', ['none'])];
  for (let k = 0; k < perTool; k++) for (const t of TOOLS) variants.push(make(k === 0 ? t : `${t}-${k + 1}`, [OPS[t]]));
  const combos: ToolId[][] = [];
  while (combos.length < 4) {
    const size = pick(rng, [2, 2, 3]);
    const set = new Set<ToolId>();
    while (set.size < size) set.add(pick(rng, TOOLS));
    const arr = [...set];
    if (!combos.some((c) => c.join() === arr.join())) combos.push(arr);
  }
  combos.forEach((c, i) => variants.push(make(`combo${i + 1}-${c.join('+')}`, rng() < 0.5 ? [...c.map((t) => OPS[t]), opDistractor] : c.map((t) => OPS[t]))));
  for (let i = 0; i < 3; i++) variants.push(make(`distractor${i + 1}`, i === 2 ? [opDistractor, opDistractor] : [opDistractor]));
  return variants;
};

// --- Carga de fuentes -------------------------------------------------------

const loadSource = async (file: string): Promise<{ mono: Float32Array; fs: number }> => {
  const buf = fs.readFileSync(file);
  if (/\.(wav|wave|aif|aiff)$/i.test(file)) {
    const d = decodePcm(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    if (d) return { mono: downmixMono(d.channels), fs: d.sampleRate };
  }
  const ab = await decode(new Uint8Array(buf));
  const channels = ab.channelData.map((c) => Float32Array.from(c));
  if (!channels.length || !ab.sampleRate) throw new Error('El decodificador no devolvió audio.');
  return { mono: downmixMono(channels), fs: ab.sampleRate };
};

const syntheticSources = (rng: Rng, clip: number): { entry: SourceEntry; mono: Float32Array; fs: number }[] => {
  const kinds = ['bell', 'pluck', 'vowel', 'texture', 'perc', 'pad'] as const;
  const out: { entry: SourceEntry; mono: Float32Array; fs: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const kind = kinds[i % kinds.length]; const fsr = pick(rng, [44100, 48000]);
    out.push({ entry: { id: `sint-${kind}-${i + 1}`, file: '', category: kind, description: `Fuente sintética ${kind} #${i + 1}`, license: 'CC0 (generada)', attribution: 'scripts/corpus', sourceUrl: '' }, mono: synthSource(kind, fsr, clip, rng), fs: fsr });
  }
  return out;
};

// --- Main --------------------------------------------------------------------

const main = async () => {
  const args = parseArgs();
  const rngGlobal = mulberry32(args.seed);
  const outAudio = path.join(args.out, 'audio');
  fs.mkdirSync(outAudio, { recursive: true });

  let sources: { entry: SourceEntry; mono: Float32Array; fs: number }[] = [];
  if (args.synthetic) sources = syntheticSources(rngGlobal, args.clip);
  else {
    const manifestPath = path.join(args.sources, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`No existe ${manifestPath}. Ejecuta primero fetch-sources.ts.`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SourceEntry[];
    for (const entry of manifest.slice(0, args.maxSources)) {
      const file = path.join(args.sources, 'files', entry.file);
      try { const { mono, fs: sr } = await loadSource(file); sources.push({ entry, mono, fs: sr }); }
      catch (e) { console.warn(`  ✗ ${entry.id}: ${(e as Error).message}`); }
    }
  }
  console.log(`Fuentes cargadas: ${sources.length}`);

  const records: ReviewRecord[] = [];
  const seenIds = new Set<string>();
  const index: { file: string; id: string; sourceGroup: string; chain: string[]; labels: Labels; seconds: number; audio?: string; variant: string }[] = [];
  const sourcesOut: { id: string; category: string; description: string; license: string; attribution: string; sourceUrl: string; sampleRate: number; seconds: number }[] = [];
  const outMp3 = path.join(args.out, 'audio');
  if (args.mp3) fs.mkdirSync(outMp3, { recursive: true });
  const encodeMp3 = (mono: Float32Array, sr: number): Buffer => {
    const target = 16000;
    const x = sr === target ? mono : resampleMonoLinear(mono, sr, target);
    const n = Math.min(x.length, Math.round(args.mp3Seconds * target));
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) { const fade = Math.min(1, (n - i) / (0.05 * target)); pcm[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * fade * 32767))); }
    const enc = new (loadLame().Mp3Encoder)(1, target, 48);
    const chunks: Buffer[] = [];
    for (let i = 0; i < n; i += 1152) { const c = enc.encodeBuffer(pcm.subarray(i, i + 1152)); if (c.length) chunks.push(Buffer.from(c)); }
    const end = enc.flush(); if (end.length) chunks.push(Buffer.from(end));
    return Buffer.concat(chunks);
  };
  const now = new Date().toISOString();
  let sourceIndex = 0;
  for (const { entry, mono, fs: sr } of sources) {
    const writeWav = args.wav === 'all' && sourceIndex++ < args.wavMax;
    let source: Float32Array;
    try { source = normalizePeak(trimTo(mono, sr, args.clip), -3); } catch (e) { console.warn(`  ✗ ${entry.id}: ${(e as Error).message}`); continue; }
    sourcesOut.push({ id: entry.id, category: entry.category, description: entry.description, license: entry.license, attribution: entry.attribution, sourceUrl: entry.sourceUrl, sampleRate: sr, seconds: +(source.length / sr).toFixed(2) });
    const rng = mulberry32(hashSeed(entry.id) ^ args.seed);
    const variants = planVariants(source, sr, rng, args.perTool);
    for (const v of variants) {
      const wav = encodeWav16([v.audio], sr);
      const bytes = Buffer.from(wav);
      const id = createHash('sha256').update(bytes).digest('hex');
      const name = `${entry.id}__${v.name}.wav`;
      // Dos ajustes aleatorios pueden coincidir (mismo semitono, mismo factor): el audio sería idéntico y el id también.
      if (seenIds.has(id)) { console.log(`    · ${v.name} duplica otra variante, se omite`); continue; }
      seenIds.add(id);
      if (writeWav) fs.writeFileSync(path.join(outAudio, name), bytes);
      let audioRel: string | undefined;
      if (args.mp3 && (v.name === 'original' || TOOLS.includes(v.name as ToolId))) { const mp3Name = `${entry.id}__${v.name}.mp3`; fs.writeFileSync(path.join(outMp3, mp3Name), encodeMp3(v.audio, sr)); audioRel = `audio/${mp3Name}`; }
      const decoded = decodePcm(wav)!;
      const features = extractFeatures(decoded, { fileName: name, sizeBytes: bytes.length });
      const rec = createReview(id, name, features, args.synthetic ? 'synthetic' : 'real');
      rec.createdAt = now; rec.updatedAt = now;
      rec.sourceGroup = entry.id;
      rec.labels = { ...v.labels };
      rec.evidence = { ...v.evidence };
      rec.extra = v.extra;
      rec.overprocessing = v.overprocessing;
      rec.synopsis = `Variante "${v.name}" de la fuente "${entry.description}" (${entry.category}).`;
      rec.context = `Corpus generado por scripts/corpus/build-corpus.ts (semilla ${args.seed}). Cadena de proceso: ${v.chain.length ? v.chain.join(' → ') : 'ninguna (original recortado)'}. Etiquetas exactas por construcción.`;
      rec.notes = `Fuente: ${entry.description}. Licencia: ${entry.license}. Atribución: ${entry.attribution}. Origen: ${entry.sourceUrl || 'sintética'}.`;
      records.push(rec);
      index.push({ file: name, id, sourceGroup: entry.id, chain: v.chain, labels: v.labels, seconds: +(v.audio.length / sr).toFixed(2), audio: audioRel, variant: v.name });
    }
    console.log(`  ✓ ${entry.id}: ${variants.length} variantes (${(source.length / sr).toFixed(1)} s, ${sr} Hz)`);
  }

  const jsonSafe = (_k: string, value: unknown) => (value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : typeof value === 'number' && Number.isNaN(value) ? null : value);
  const dataset = { version: 1 as const, exportedAt: now, audioIncluded: false, records };
  const text = JSON.stringify(dataset, jsonSafe, 1);
  DatasetSchema.parse(JSON.parse(text)); // garantiza que Biblioteca lo aceptará
  fs.writeFileSync(path.join(args.out, 'coleccion.json'), text);
  fs.writeFileSync(path.join(args.out, 'indice.json'), JSON.stringify({ version: 1, generatedAt: now, seed: args.seed, clipSeconds: args.clip, mp3Seconds: args.mp3 ? args.mp3Seconds : 0, sources: sourcesOut, records: index }, null, 1));

  const counts = TOOLS.map((t) => `${t}: ${records.filter((r) => r.labels[t] === 'present').length} presentes / ${records.filter((r) => r.labels[t] === 'absent').length} ausentes`).join('\n  ');
  console.log(`\nRegistros: ${records.length} en ${sources.length} grupos de origen\n  ${counts}\nJSON: ${path.join(args.out, 'coleccion.json')} (${(text.length / 1e6).toFixed(1)} MB)`);
};

main().catch((e) => { console.error(e); process.exit(1); });
