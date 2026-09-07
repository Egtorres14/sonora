/**
 * Comprueba una clave de API con una llamada barata (listar modelos). No consume tokens.
 * Los SDK se cargan bajo demanda para no engordar el bundle inicial.
 */
import type { ProviderId } from './types';

export interface KeyCheckResult { ok: boolean; message: string }

export const testKey = async (provider: ProviderId, key: string, signal?: AbortSignal): Promise<KeyCheckResult> => {
  const apiKey = key.trim();
  if (!apiKey) return { ok: false, message: 'Introduce una clave.' };
  try {
    if (provider === 'gemini') {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const pager = await ai.models.list({ config: { pageSize: 5, abortSignal: signal } });
      const first = pager.page?.[0];
      return { ok: true, message: `Clave válida${first?.name ? ` · ${String(first.name).replace('models/', '')} disponible` : ''}.` };
    }
    if (provider === 'openai') {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
      const page = await client.models.list({ signal });
      return { ok: true, message: `Clave válida · ${page.data.length} modelos visibles.` };
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const page = await client.models.list({ limit: 5 }, { signal });
    return { ok: true, message: `Clave válida · ${page.data.length > 0 ? page.data[0].id : 'modelos'} disponible.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/401|403|API key|invalid|authentication|permission/i.test(msg)) return { ok: false, message: 'La clave no es válida o no tiene permisos.' };
    if (/429|quota|rate/i.test(msg)) return { ok: false, message: 'La clave responde pero está limitada (cuota o tasa).' };
    if (/fetch|network|CORS|Failed to/i.test(msg)) return { ok: false, message: 'No se pudo conectar con el proveedor (red o CORS).' };
    return { ok: false, message: msg.slice(0, 160) };
  }
};
