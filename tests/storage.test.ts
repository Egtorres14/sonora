import { describe, expect, it } from 'vitest';
import { formatBytes, isQuotaError, storageWarning, type StorageState } from '../services/storage';

const state = (patch: Partial<StorageState>): StorageState => ({ persisted: true, usageBytes: 0, quotaBytes: 10e9, ratio: 0, ...patch });

describe('Aviso de almacenamiento', () => {
  it('avisa cuando la cuota está casi llena', () => {
    const warning = storageWarning(state({ usageBytes: 9e9, quotaBytes: 10e9, ratio: 0.9 }));
    expect(warning).toMatch(/poco espacio/i);
  });

  it('avisa si el navegador no garantiza la persistencia y ya hay audio que perder', () => {
    const warning = storageWarning(state({ persisted: false, usageBytes: 400 * 1024 * 1024, ratio: 0.04 }));
    expect(warning).toMatch(/persistente/i);
  });

  it('no interrumpe a quien acaba de empezar', () => {
    expect(storageWarning(state({ persisted: false, usageBytes: 5 * 1024 * 1024, ratio: 0.001 }))).toBe('');
    expect(storageWarning(state({ usageBytes: 3e9, ratio: 0.3 }))).toBe('');
  });

  it('calla si el navegador no informa del espacio', () => {
    expect(storageWarning(null)).toBe('');
  });

  it('reconoce el error de cuota agotada', () => {
    expect(isQuotaError(new DOMException('lleno', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError(new Error('otra cosa'))).toBe(false);
  });

  it('expresa los tamaños en unidades legibles', () => {
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe('3.5 GB');
  });
});
