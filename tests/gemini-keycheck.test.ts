import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testKey } from '../services/llm/keycheck';

const { generateContent, list } = vi.hoisted(() => ({ generateContent: vi.fn(), list: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent, list }; } }));

describe('Comprobación del modelo Gemini elegido', () => {
  beforeEach(() => { vi.clearAllMocks(); list.mockResolvedValue({ page: [{ name: 'models/gemini-2.5-flash' }] }); generateContent.mockResolvedValue({ text: 'OK', modelVersion: 'gemini-3.8-flash' }); });
  it('genera con el modelo seleccionado y no informa del primero del catálogo', async () => {
    const result = await testKey('gemini', 'test-key', undefined, 'gemini-3.8-flash');
    expect(generateContent.mock.calls[0][0].model).toBe('gemini-3.8-flash');
    expect(generateContent.mock.calls[0][0].config.maxOutputTokens).toBeGreaterThanOrEqual(256);
    expect(result).toMatchObject({ ok: true, model: 'gemini-3.8-flash' });
    expect(result.message).not.toContain('2.5');
    expect(result.message).not.toContain('saldo');
  });
  it('distingue una respuesta vacía de una generación completa', async () => {
    generateContent.mockResolvedValue({ text: '', candidates: [{ finishReason: 'MAX_TOKENS' }] });
    expect((await testKey('gemini', 'test-key', undefined, 'gemini-3.8-flash')).ok).toBe(false);
  });
  it('no confunde un modelo inaccesible ni cuota con una clave inválida', async () => {
    generateContent.mockRejectedValue(new Error('404 model not found for API version'));
    expect((await testKey('gemini', 'test-key', undefined, 'missing')).message).toMatch(/modelo/i);
    generateContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED quota'));
    expect((await testKey('gemini', 'test-key')).message).toMatch(/cuota|tasa/i);
  });
  it('no expone una clave si el proveedor la incluye en un error', async () => {
    generateContent.mockRejectedValue(new Error('Unknown server error for test-secret-key'));
    expect((await testKey('gemini', 'test-secret-key')).message).not.toContain('test-secret-key');
  });
});
