/**
 * Carga lamejs desde su build agrupado (`lame.all.js`). El `main` del paquete (src/js/index.js)
 * falla en Node porque Lame.js usa `MPEGMode` como global; el build agrupado es autocontenido
 * pero no exporta nada: define `lamejs` y le cuelga Mp3Encoder, así que lo evaluamos y lo devolvemos.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

export interface Mp3Encoder {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
}
interface LameModule { Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => Mp3Encoder }

let cached: LameModule | null = null;
export const loadLame = (): LameModule => {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  const file = require.resolve('lamejs/lame.all.js');
  const src = fs.readFileSync(file, 'utf8');
  cached = new Function(`${src};return lamejs;`)() as LameModule;
  return cached;
};
