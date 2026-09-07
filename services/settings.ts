/**
 * Ajustes del motor de IA persistidos en localStorage (solo en el navegador del profesor).
 * ADVERTENCIA: las claves guardadas en el navegador son accesibles para cualquier script de la página.
 * Para uso compartido o público, mueve las llamadas a un backend/proxy.
 */
import type { ProviderId } from './llm/types';
import { defaultModelFor, MODEL_CATALOG } from './llm/catalog';

export interface LLMSettings {
  provider: ProviderId;
  model: string;
  runs: 1 | 3 | 5;
  rememberKeys: boolean;
}

const SETTINGS_KEY = 'ape.settings.v2';
const keyName = (p: ProviderId) => `ape.key.${p}`;

export const DEFAULT_SETTINGS: LLMSettings = { provider: 'gemini', model: defaultModelFor('gemini').id, runs: 1, rememberKeys: false };

export const loadSettings = (): LLMSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<LLMSettings>;
    const provider = ['gemini', 'openai', 'anthropic'].includes(parsed.provider ?? '') ? parsed.provider! : DEFAULT_SETTINGS.provider;
    const model = MODEL_CATALOG.find(m => m.provider === provider && m.id === parsed.model)?.id ?? defaultModelFor(provider).id;
    return { provider, model, runs: [1, 3, 5].includes(parsed.runs ?? 0) ? parsed.runs! : 1, rememberKeys: parsed.rememberKeys === true };
  } catch { return DEFAULT_SETTINGS; }
};

export const saveSettings = (s: LLMSettings) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ } };

export const loadKey = (p: ProviderId): string => {
  try { return loadSettings().rememberKeys ? localStorage.getItem(keyName(p)) || '' : ''; } catch { return ''; }
};

export const saveKey = (p: ProviderId, key: string, remember: boolean) => {
  try {
    if (remember && key) localStorage.setItem(keyName(p), key);
    else localStorage.removeItem(keyName(p));
  } catch { /* sin almacenamiento */ }
};

export const clearAllKeys = () => { try { (['gemini', 'openai', 'anthropic'] as ProviderId[]).forEach((p) => localStorage.removeItem(keyName(p))); } catch { /* */ } };
