/**
 * Espacio del navegador. La aplicación promete que el audio se queda en el equipo, pero IndexedDB es
 * almacenamiento «best effort»: sin permiso de persistencia el navegador puede desalojar una colección
 * entera cuando necesite sitio, y sin avisar. Aquí se pide ese permiso y se mide cuánto queda para
 * poder decírselo al profesor antes de que sea tarde.
 */
export interface StorageState {
  /** El navegador se ha comprometido a no desalojar estos datos. */
  persisted: boolean;
  usageBytes: number;
  quotaBytes: number;
  /** Fracción de la cuota usada, o null si el navegador no la informa. */
  ratio: number | null;
}

const storageApi = (): StorageManager | null => {
  try { return typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null; }
  catch { return null; }
};

/** Pide almacenamiento persistente. Devuelve si quedó concedido; nunca lanza. */
export const requestPersistentStorage = async (): Promise<boolean> => {
  const storage = storageApi();
  if (!storage?.persist) return false;
  try {
    if (storage.persisted && await storage.persisted()) return true;
    return await storage.persist();
  } catch { return false; }
};

export const readStorageState = async (): Promise<StorageState | null> => {
  const storage = storageApi();
  if (!storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await storage.estimate();
    const persisted = storage.persisted ? await storage.persisted() : false;
    return { persisted, usageBytes: usage, quotaBytes: quota, ratio: quota > 0 ? usage / quota : null };
  } catch { return null; }
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

/** Umbral a partir del cual avisar de que el espacio aprieta. */
const FULL_RATIO = 0.85;
/** Por debajo de esto, que no haya persistencia concedida no merece interrumpir a nadie. */
const AT_RISK_BYTES = 200 * 1024 * 1024;

/** Aviso para el profesor, o cadena vacía si no hay nada que decir. */
export const storageWarning = (state: StorageState | null): string => {
  if (!state) return '';
  if (state.ratio !== null && state.ratio >= FULL_RATIO) {
    return `Queda poco espacio en este navegador (${formatBytes(state.usageBytes)} de ${formatBytes(state.quotaBytes)}). Exporta la colección y elimina muestras que ya no necesites antes de seguir subiendo audio.`;
  }
  if (!state.persisted && state.usageBytes >= AT_RISK_BYTES) {
    return `Este navegador no ha concedido almacenamiento persistente y ya guardas ${formatBytes(state.usageBytes)}: puede borrar los audios si necesita espacio. Exporta la colección con regularidad y conserva los archivos originales.`;
  }
  return '';
};

/** El error de IndexedDB cuando no cabe nada más, en lenguaje claro. */
export const isQuotaError = (error: unknown): boolean =>
  error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
