/**
 * Comprueba una clave de API. OpenAI y Anthropic: listar modelos (no consume tokens).
 * Gemini: generación breve con el modelo seleccionado. Listar modelos no confirma
 * que ese modelo pueda generar; una respuesta correcta tampoco revela el saldo.
 * Los SDK se cargan bajo demanda para no engordar el bundle inicial.
 */
import type { ProviderId } from './types';
import { defaultModelFor } from './catalog';

export interface KeyCheckResult { ok: boolean; message: string; model?: string }

export const testKey = async (provider: ProviderId, key: string, signal?: AbortSignal, selectedModel?: string): Promise<KeyCheckResult> => {
  const apiKey = key.trim();
  if (!apiKey) return { ok: false, message: 'Introduce una clave.' };
  try {
    if (provider === 'gemini') {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const model = selectedModel || defaultModelFor('gemini').id;
      // Thinking models need room for reasoning plus the short answer.
      const response = await ai.models.generateContent({ model, contents: 'Responde únicamente OK.', config: { maxOutputTokens: 512, abortSignal: signal } });
      if (!response.text?.trim()) return { ok: false, model, message: `${model} aceptó la petición, pero no devolvió texto. No se ha confirmado una generación completa; vuelve a probar.` };
      return { ok: true, model, message: `Conexión comprobada · ${model} respondió. Prueba breve de texto; la evaluación de audio se comprueba al analizar.` };
    }
    if (provider === 'openrouter') {
      const headers = { Authorization: `Bearer ${apiKey}` };
      const keyRes = await fetch('https://openrouter.ai/api/v1/key', { headers, signal });
      if (keyRes.status === 401 || keyRes.status === 403) return { ok: false, message: 'La clave de OpenRouter no es válida.' };
      if (!keyRes.ok) throw new Error(`OpenRouter respondió ${keyRes.status}.`);
      const credits = await fetch('https://openrouter.ai/api/v1/credits', { headers, signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { data?: { total_credits?: number; total_usage?: number } } | null;
      const balance = credits?.data ? (credits.data.total_credits ?? 0) - (credits.data.total_usage ?? 0) : null;
      if (balance !== null && balance < 0.5) return { ok: true, message: `Clave válida · saldo ${balance.toFixed(2)} $. Sin 0,50 $ OpenRouter no acepta audio: funcionan los modelos gratuitos con espectrograma + métricas y el redactor de feedback.` };
      return { ok: true, message: balance === null ? 'Clave válida.' : `Clave válida y con saldo (${balance.toFixed(2)} $).` };
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
    const msg = (e instanceof Error ? e.message : String(e)).replaceAll(apiKey, '[clave omitida]');
    if (signal?.aborted) return { ok: false, message: 'Prueba cancelada.' };
    if (/404|model.*not found|not found for API version|model.*not supported/i.test(msg)) return { ok: false, message: `El modelo ${selectedModel ?? 'seleccionado'} no está disponible para esta clave o versión de la API. Elige otro modelo.` };
    if (/401|403|API_KEY_INVALID|API key (?:not valid|expired)|authentication|permission/i.test(msg)) return { ok: false, message: 'La clave no es válida o no tiene permisos.' };
    if (/credits|prepay|billing/i.test(msg)) return { ok: false, message: 'La clave es válida, pero su proyecto no tiene saldo. Añade crédito o activa la facturación en el panel del proveedor.' };
    if (/429|quota|rate/i.test(msg)) return { ok: false, message: 'La clave responde pero está limitada (cuota o tasa).' };
    if (/fetch|network|CORS|Failed to/i.test(msg)) return { ok: false, message: 'No se pudo conectar con el proveedor (red o CORS).' };
    return { ok: false, message: msg.slice(0, 160) };
  }
};
