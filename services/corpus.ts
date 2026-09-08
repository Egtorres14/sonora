/**
 * Corpus de muestras publicado junto con la app (public/corpus/).
 *
 *   indice.json     fuentes (licencia, atribución) y registros (cadena de procesos, etiquetas, mp3 de escucha)
 *   coleccion.json  colección importable en Biblioteca (mismo esquema que exporta la app)
 *   modelo.json     modelo local entrenado con esa colección (scripts/contrib/train-community.ts)
 *   audio/*.mp3     extractos de 12 s a 16 kHz para escuchar cada proceso; no sirven para medir
 */
import { z } from 'zod';
import { DatasetSchema } from './library-schema';
import type { ReviewRecord } from './review';
import type { LocalModel } from './learning/types';
import type { ToolId } from './scoring/rubric';

export const TOOL_IDS: ToolId[] = ['pitch_shift', 'time_stretch', 'reversa', 'filtros', 'loops'];
const LabelSchema = z.enum(['present', 'absent']);
export const CorpusIndexSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  seed: z.number(),
  clipSeconds: z.number(),
  mp3Seconds: z.number(),
  sources: z.array(z.object({ id: z.string(), category: z.string(), description: z.string(), license: z.string(), attribution: z.string(), sourceUrl: z.string(), sampleRate: z.number(), seconds: z.number() })),
  records: z.array(z.object({ file: z.string(), id: z.string(), sourceGroup: z.string(), chain: z.array(z.string()), labels: z.record(z.string(), LabelSchema), seconds: z.number(), audio: z.string().optional(), variant: z.string() })),
});
export type CorpusIndex = z.infer<typeof CorpusIndexSchema>;
export type CorpusSource = CorpusIndex['sources'][number];
export type CorpusRecord = CorpusIndex['records'][number];

/** URL absoluta dentro del despliegue (respeta la base de GitHub Pages). */
export const corpusUrl = (file: string, base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') => `${base.endsWith('/') ? base : `${base}/`}corpus/${file}`;

const fetchJson = async (file: string, signal?: AbortSignal) => {
  const res = await fetch(corpusUrl(file), { signal });
  if (!res.ok) throw new Error(`No se pudo descargar ${file} (${res.status}).`);
  return res.json();
};

export const fetchCorpusIndex = async (signal?: AbortSignal): Promise<CorpusIndex> => {
  try { return CorpusIndexSchema.parse(await fetchJson('indice.json', signal)); }
  catch (e) { if (e instanceof Error && e.name === 'AbortError') throw e; throw new Error('El índice del corpus no está disponible o no tiene el formato esperado.'); }
};
export const fetchCorpusCollection = async (signal?: AbortSignal): Promise<ReviewRecord[]> => DatasetSchema.parse(await fetchJson('coleccion.json', signal)).records as ReviewRecord[];
export const fetchCorpusModel = async (signal?: AbortSignal): Promise<LocalModel | null> => {
  const res = await fetch(corpusUrl('modelo.json'), { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`No se pudo descargar el modelo (${res.status}).`);
  const model = await res.json() as LocalModel;
  if (model.version !== '1' || !model.effects || !model.trainedAt) throw new Error('El modelo publicado no tiene el formato esperado.');
  return model;
};

/** Nombre legible de cada paso de la cadena de procesos («pitch+7» → «Pitch shift +7 st»). */
export const describeChainStep = (step: string): string => {
  if (step === 'none') return 'Sin procesar';
  if (step.startsWith('pitch')) return `Pitch shift ${step.slice(5)} semitonos`;
  if (step.startsWith('stretch')) return `Time stretch ${step.slice(7)}`;
  if (step === 'reverse') return 'Reversa completa';
  if (step === 'reverse-reverb') return 'Reverse reverb';
  if (step.startsWith('reverse-seg')) return `Reversa por segmentos (${step.slice(11)})`;
  if (step.startsWith('loop')) return `Loop ${step.slice(4)}`;
  const filters: Record<string, string> = { 'lp-sweep': 'Paso bajo con barrido', 'hp-sweep': 'Paso alto con barrido', 'bp-sweep': 'Paso banda con barrido', 'lp-static': 'Paso bajo fijo', 'hp-static': 'Paso alto fijo', lfo: 'Filtro modulado por LFO' };
  if (filters[step]) return filters[step];
  const distractors: Record<string, string> = { reverb: 'Reverb', delay: 'Delay', gain: 'Ganancia', saturate: 'Saturación', tremolo: 'Trémolo', noise: 'Ruido', 'reverb-delay': 'Reverb + delay' };
  return distractors[step] ?? step;
};

export const VARIANT_LABEL: Record<string, string> = { original: 'Original', pitch_shift: 'Pitch shift', time_stretch: 'Time stretch', reversa: 'Reversa', filtros: 'Filtros', loops: 'Loops' };

/** Resumen por herramienta (presentes/ausentes) para la cabecera de la vista. */
export const corpusCoverage = (index: CorpusIndex) => TOOL_IDS.map((tool) => ({ tool, present: index.records.filter((r) => r.labels[tool] === 'present').length, absent: index.records.filter((r) => r.labels[tool] === 'absent').length }));

export const CATEGORY_LABEL: Record<string, string> = { 'acoustic-guitar': 'Guitarra acústica', 'bells-metallic': 'Campanas y metal', 'brass-woodwind': 'Viento', 'drum-hits': 'Batería', 'field-recording': 'Grabación de campo', 'hand-percussion': 'Percusión de mano', piano: 'Piano', 'synth-electronic': 'Sintetizador', 'violin-strings': 'Cuerda', 'voice-singing': 'Voz cantada', 'voice-speech': 'Voz hablada' };
export const categoryLabel = (c: string) => CATEGORY_LABEL[c.toLowerCase()] ?? c.charAt(0).toUpperCase() + c.slice(1);
