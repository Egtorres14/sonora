/**
 * Comprueba una clave de API. OpenAI y Anthropic: listar modelos (no consume tokens).
 * Gemini: listar modelos y, además, una generación de un token, porque el listado responde bien
 * aunque el proyecto no tenga saldo y la evaluación fallaría después con 429.
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
      // Generación mínima: confirma que el proyecto tiene saldo (≈ 0,00001 $).
      await ai.models.generateContent({ model: 'gemini-3.5-flash-lite', contents: 'ok', config: { maxOutputTokens: 1, abortSignal: signal } });
      return { ok: true, message: `Clave válida y con saldo${first?.name ? ` · ${String(first.name).replace('models/', '')} disponible` : ''}.` };
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
    const msg = e instanceof Error ? e.message : String(e);
    if (/401|403|API key|invalid|authentication|permission/i.test(msg)) return { ok: false, message: 'La clave no es válida o no tiene permisos.' };
    if (/credits|prepay|billing/i.test(msg)) return { ok: false, message: 'La clave es válida, pero su proyecto no tiene saldo. Añade crédito o activa la facturación en el panel del proveedor.' };
    if (/429|quota|rate/i.test(msg)) return { ok: false, message: 'La clave responde pero está limitada (cuota o tasa).' };
    if (/fetch|network|CORS|Failed to/i.test(msg)) return { ok: false, message: 'No se pudo conectar con el proveedor (red o CORS).' };
    return { ok: false, message: msg.slice(0, 160) };
  }
};
