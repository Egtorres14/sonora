/**
 * Cola de guardado agrupada. Escribir en la sinopsis o en el feedback dispara un cambio por tecla,
 * y cada registro lleva dentro todas las mediciones del archivo: guardarlo entero en cada pulsación
 * llena el disco de escrituras idénticas. Aquí se agrupan por registro (gana la última versión) y se
 * escriben como mucho una vez cada `delayMs`, sin perder la última pulsación.
 */
import type { ReviewRecord } from './review';

export interface SaveQueueOptions {
  /** Separación mínima entre escrituras del mismo lote. */
  delayMs?: number;
  onError?: (error: unknown) => void;
  /** Registros pendientes de escribir (encolados o escribiéndose). */
  onPendingChange?: (pending: number) => void;
}

export interface SaveQueue {
  queue: (record: ReviewRecord) => void;
  /** Escribe lo pendiente ya y espera a que termine. Úsalo antes de leer, borrar o importar. */
  flush: () => Promise<void>;
  pending: () => number;
}

export const createSaveQueue = (save: (record: ReviewRecord) => Promise<void>, options: SaveQueueOptions = {}): SaveQueue => {
  const delayMs = options.delayMs ?? 400;
  const waiting = new Map<string, ReviewRecord>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let writing = 0;

  const pending = () => waiting.size + writing;
  const notify = () => options.onPendingChange?.(pending());

  const write = (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!waiting.size) return chain;
    const batch = [...waiting.values()];
    waiting.clear();
    writing += batch.length;
    chain = chain
      .then(async () => { for (const record of batch) await save(record); })
      .catch(error => { options.onError?.(error); })
      .finally(() => { writing -= batch.length; notify(); });
    notify();
    return chain;
  };

  return {
    queue(record) {
      waiting.set(record.id, record);
      notify();
      // Ventana fija: mientras se escribe seguido, se guarda una vez cada `delayMs` en lugar de no
      // guardar nada hasta que el profesor deje de teclear.
      if (!timer) timer = setTimeout(write, delayMs);
    },
    flush() { return write(); },
    pending,
  };
};
