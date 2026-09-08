/**
 * Motores de segunda opinión: el profesor elige entre el modelo local (gratis) y proveedores
 * externos con su propia clave, y decide si los estudiantes reciben una lectura orientativa.
 * Todo se guarda en el navegador; ningún motor cambia etiquetas ni notas.
 */
import type { ProviderId } from './llm/types';
import { defaultModelFor, findModel, estimateCost } from './llm/catalog';

export type EngineId = 'local' | ProviderId;
export interface KeyStatus { ok: boolean; checkedAt: string; message: string; model?: string }
/** independiente: el modelo escucha sin pistas. refuerzo: recibe el clasificador local y las decisiones del profesor y las contrasta. */
export type AnalysisMode = 'independiente' | 'refuerzo';
/** local: borrador determinista. ia: el modelo externo redacta el feedback a partir de la revisión cerrada. */
export type FeedbackWriter = 'local' | 'ia';
export interface EngineSettings {
  engine: EngineId;
  models: Record<ProviderId, string>;
  runs: 1 | 3 | 5;
  /** Los estudiantes pueden pedir una lectura orientativa (usa la clave y el presupuesto del profesor). */
  studentAccess: boolean;
  keyStatus: Partial<Record<ProviderId, KeyStatus>>;
  /** Se aplica a todas las consultas (profesor y estudiantes). */
  analysisMode: AnalysisMode;
  /** Cómo se redacta «Redactar borrador» para todos los estudiantes. */
  feedbackWriter: FeedbackWriter;
}

const KEY = 'sonora.engines.v1';
const memory = new Map<string, string>();
const store = {
  get(k: string) { if (memory.has(k)) return memory.get(k)!; try { return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set(k: string, v: string): boolean {
    memory.set(k, v);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(k, v);
        if (localStorage.getItem(k) === v) { memory.delete(k); return true; }
      }
    } catch { /* Keep the session copy and report that persistence failed. */ }
    return false;
  },
  remove(k: string) { try { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); } catch { /* */ } memory.delete(k); },
};

export const DEFAULT_ENGINES: EngineSettings = {
  engine: 'local',
  models: { gemini: defaultModelFor('gemini').id, openai: defaultModelFor('openai').id, anthropic: defaultModelFor('anthropic').id, openrouter: defaultModelFor('openrouter').id },
  runs: 1,
  studentAccess: false,
  keyStatus: {},
  analysisMode: 'independiente',
  feedbackWriter: 'local',
};

export const loadEngineSettings = (): EngineSettings => {
  try {
    const raw = store.get(KEY);
    if (!raw) return DEFAULT_ENGINES;
    const s = JSON.parse(raw) as Partial<EngineSettings>;
    const models = { ...DEFAULT_ENGINES.models, ...(s.models ?? {}) };
    (Object.keys(models) as ProviderId[]).forEach((p) => { if (!findModel(models[p]) || findModel(models[p])!.provider !== p) models[p] = DEFAULT_ENGINES.models[p]; });
    return {
      engine: (['local', 'gemini', 'openai', 'anthropic', 'openrouter'] as EngineId[]).includes(s.engine as EngineId) ? (s.engine as EngineId) : 'local',
      models,
      runs: s.runs === 3 || s.runs === 5 ? s.runs : 1,
      studentAccess: !!s.studentAccess,
      keyStatus: s.keyStatus ?? {},
      analysisMode: s.analysisMode === 'refuerzo' ? 'refuerzo' : 'independiente',
      feedbackWriter: s.feedbackWriter === 'ia' ? 'ia' : 'local',
    };
  } catch { return DEFAULT_ENGINES; }
};

export const saveEngineSettings = (s: EngineSettings) => store.set(KEY, JSON.stringify(s));
export const resetEngineSettings = () => store.remove(KEY);

// ----------------------------- Llaves de API -----------------------------
// Se guardan en el navegador del profesor, una por proveedor, sin depender de ningún otro ajuste.
// ADVERTENCIA: cualquier script de la página puede leerlas; para uso compartido, usa un backend.
const PROVIDER_IDS: ProviderId[] = ['gemini', 'openai', 'anthropic', 'openrouter'];
const keyName = (p: ProviderId) => `sonora.key.${p}`;
const legacyKeyName = (p: ProviderId) => `ape.key.${p}`;

/**
 * Llave por defecto SOLO en desarrollo local (`npm run dev`): el plugin de vite.config.ts inyecta
 * window.__SONORA_DEV_KEYS__ a partir de `.env.local` (SONORA_DEV_KEY_OPENROUTER, SONORA_DEV_KEY_GEMINI, …)
 * únicamente en el servidor de desarrollo; un build de producción nunca la incluye.
 */
const devKey = (p: ProviderId): string => {
  try {
    const value = (globalThis as { __SONORA_DEV_KEYS__?: Record<string, unknown> }).__SONORA_DEV_KEYS__?.[p];
    return typeof value === 'string' ? value.trim() : '';
  } catch { return ''; }
};

/** Devuelve la llave guardada (o la de desarrollo, o ''). Migra las llaves de la versión anterior. */
export const loadKey = (p: ProviderId): string => {
  const current = store.get(keyName(p));
  if (current !== null) return current;
  const legacy = store.get(legacyKeyName(p));
  if (legacy) { store.set(keyName(p), legacy); store.remove(legacyKeyName(p)); return legacy; }
  return devKey(p);
};
/** Guarda la llave (recortada). Una cadena vacía la borra. */
export const saveKey = (p: ProviderId, key: string) => {
  const trimmed = key.trim();
  if (trimmed) return store.set(keyName(p), trimmed);
  store.remove(keyName(p)); store.remove(legacyKeyName(p));
  // Remember an explicit deletion instead of reviving a development default.
  if (devKey(p)) return store.set(keyName(p), '');
  return !loadKey(p);
};
export const isKeyPersisted = (p: ProviderId, key: string): boolean => {
  try { return !!key.trim() && typeof localStorage !== 'undefined' && localStorage.getItem(keyName(p)) === key.trim(); }
  catch { return false; }
};
export const hasKey = (p: ProviderId): boolean => loadKey(p).length > 0;
export const clearKeys = () => PROVIDER_IDS.forEach((p) => { store.remove(keyName(p)); store.remove(legacyKeyName(p)); });

export interface EngineInfo { id: EngineId; label: string; summary: string; pros: string; cons: string; listens: boolean; sees: boolean }

export const ENGINE_INFO: EngineInfo[] = [
  { id: 'local', label: 'Modelo local (Sonora)', summary: 'Bosques aleatorios entrenados con tu biblioteca. Sin red, sin claves, sin coste.', pros: 'Gratis y privado · funciona sin conexión · loops 71 % en el corpus', cons: 'Reversa casi al azar · se abstiene con pocos datos · no redacta feedback', listens: false, sees: false },
  { id: 'gemini', label: 'Google Gemini', summary: 'Escucha el audio (mono, 16 kHz) y ve el espectrograma. La mejor relación calidad/precio para juzgar creatividad.', pros: 'Oye el audio · describe lo que escucha · redacta feedback', cons: 'Nada por encima de 8 kHz ni estéreo · varía entre ejecuciones', listens: true, sees: true },
  { id: 'anthropic', label: 'Anthropic Claude', summary: 'No escucha: razona sobre el espectrograma y las mediciones. El feedback mejor escrito.', pros: 'Mejor razonamiento sobre datos · texto claro para el estudiante', cons: 'No oye el audio · 2–3 veces el coste de Gemini', listens: false, sees: true },
  { id: 'openai', label: 'OpenAI', summary: 'Escucha el audio con los modelos gpt-audio. Útil si ya pagas OpenAI; no acepta el espectrograma.', pros: 'Oye el audio · integración con cuentas OpenAI existentes', cons: 'Sin espectrograma · audio más caro por minuto · JSON estricto no garantizado', listens: true, sees: false },
  { id: 'openrouter', label: 'OpenRouter', summary: 'Una sola clave para muchos modelos, incluido uno gratuito que escucha y ve el espectrograma. Sin saldo, el audio no está disponible.', pros: 'Modelo gratuito · acceso a Gemini y GPT Audio con una clave · redacta feedback', cons: 'Audio solo con 0,50 $ de saldo · los gratuitos tienen cupo diario y no garantizan JSON estricto', listens: true, sees: true },
];

/** Coste orientativo por evaluación de `durationSec` segundos con el motor y modelo elegidos. */
export const engineCost = (s: EngineSettings, durationSec: number, runs = s.runs): number => {
  if (s.engine === 'local') return 0;
  const model = findModel(s.models[s.engine]);
  if (!model) return 0;
  return estimateCost(model, { audioSec: durationSec, runs, imagePixels: model.inputs.image ? [{ width: 1400, height: 560 }] : [] }).usd;
};
