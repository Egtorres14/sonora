/**
 * Motores de segunda opinión: el profesor elige entre el modelo local (gratis) y proveedores
 * externos con su propia clave, y decide si los estudiantes reciben una lectura orientativa.
 * Todo se guarda en el navegador; ningún motor cambia etiquetas ni notas.
 */
import type { ProviderId } from './llm/types';
import { defaultModelFor, findModel, estimateCost } from './llm/catalog';

export type EngineId = 'local' | ProviderId;
export interface KeyStatus { ok: boolean; checkedAt: string; message: string }
export interface EngineSettings {
  engine: EngineId;
  models: Record<ProviderId, string>;
  runs: 1 | 3 | 5;
  /** Los estudiantes pueden pedir una lectura orientativa (usa la clave y el presupuesto del profesor). */
  studentAccess: boolean;
  keyStatus: Partial<Record<ProviderId, KeyStatus>>;
}

const KEY = 'sonora.engines.v1';
const memory = new Map<string, string>();
const store = {
  get(k: string) { try { return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : memory.get(k) ?? null; } catch { return memory.get(k) ?? null; } },
  set(k: string, v: string) { try { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); else memory.set(k, v); } catch { memory.set(k, v); } },
  remove(k: string) { try { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); } catch { /* */ } memory.delete(k); },
};

export const DEFAULT_ENGINES: EngineSettings = {
  engine: 'local',
  models: { gemini: defaultModelFor('gemini').id, openai: defaultModelFor('openai').id, anthropic: defaultModelFor('anthropic').id },
  runs: 1,
  studentAccess: false,
  keyStatus: {},
};

export const loadEngineSettings = (): EngineSettings => {
  try {
    const raw = store.get(KEY);
    if (!raw) return DEFAULT_ENGINES;
    const s = JSON.parse(raw) as Partial<EngineSettings>;
    const models = { ...DEFAULT_ENGINES.models, ...(s.models ?? {}) };
    (Object.keys(models) as ProviderId[]).forEach((p) => { if (!findModel(models[p]) || findModel(models[p])!.provider !== p) models[p] = DEFAULT_ENGINES.models[p]; });
    return {
      engine: (['local', 'gemini', 'openai', 'anthropic'] as EngineId[]).includes(s.engine as EngineId) ? (s.engine as EngineId) : 'local',
      models,
      runs: s.runs === 3 || s.runs === 5 ? s.runs : 1,
      studentAccess: !!s.studentAccess,
      keyStatus: s.keyStatus ?? {},
    };
  } catch { return DEFAULT_ENGINES; }
};

export const saveEngineSettings = (s: EngineSettings) => store.set(KEY, JSON.stringify(s));
export const resetEngineSettings = () => store.remove(KEY);

export interface EngineInfo { id: EngineId; label: string; summary: string; pros: string; cons: string; listens: boolean; sees: boolean }

export const ENGINE_INFO: EngineInfo[] = [
  { id: 'local', label: 'Modelo local (Sonora)', summary: 'Bosques aleatorios entrenados con tu biblioteca. Sin red, sin claves, sin coste.', pros: 'Gratis y privado · funciona sin conexión · loops 71 % en el corpus', cons: 'Reversa casi al azar · se abstiene con pocos datos · no redacta feedback', listens: false, sees: false },
  { id: 'gemini', label: 'Google Gemini', summary: 'Escucha el audio (mono, 16 kHz) y ve el espectrograma. La mejor relación calidad/precio para juzgar creatividad.', pros: 'Oye el audio · describe lo que escucha · redacta feedback', cons: 'Nada por encima de 8 kHz ni estéreo · varía entre ejecuciones', listens: true, sees: true },
  { id: 'anthropic', label: 'Anthropic Claude', summary: 'No escucha: razona sobre el espectrograma y las mediciones. El feedback mejor escrito.', pros: 'Mejor razonamiento sobre datos · texto claro para el estudiante', cons: 'No oye el audio · 2–3 veces el coste de Gemini', listens: false, sees: true },
  { id: 'openai', label: 'OpenAI', summary: 'Escucha el audio con los modelos gpt-audio. Útil si ya pagas OpenAI; no acepta el espectrograma.', pros: 'Oye el audio · integración con cuentas OpenAI existentes', cons: 'Sin espectrograma · audio más caro por minuto · JSON estricto no garantizado', listens: true, sees: false },
];

/** Coste orientativo por evaluación de `durationSec` segundos con el motor y modelo elegidos. */
export const engineCost = (s: EngineSettings, durationSec: number, runs = s.runs): number => {
  if (s.engine === 'local') return 0;
  const model = findModel(s.models[s.engine]);
  if (!model) return 0;
  return estimateCost(model, { audioSec: durationSec, runs, imagePixels: model.inputs.image ? [{ width: 1400, height: 560 }] : [] }).usd;
};
