import { encodeWav16 } from './wav';

export const DEMOS = [
  { id: 'clean', name: 'campana_estudio.wav', title: 'Campana de estudio', description: 'Una pieza limpia de 60 s para explorar los medidores.', issue: 'Referencia limpia', duration: '1:00' },
  { id: 'clicks', name: 'campana_cortes.wav', title: 'Edición con clics', description: 'Tres impulsos añadidos en los segundos 12, 28 y 43.', issue: '3 clics insertados', duration: '1:00' },
  { id: 'clipping', name: 'campana_saturada.wav', title: 'Ganancia al límite', description: 'Saturación intencional entre los segundos 20 y 21.', issue: 'Clipping insertado', duration: '1:00' },
  { id: 'reverse', name: 'campana_reversa.wav', title: 'El sonido al revés', description: 'Envolventes invertidas para contrastar escucha y detección.', issue: 'Reversa sintética', duration: '1:00' },
] as const;
export type DemoId = typeof DEMOS[number]['id'];

export const createDemo = (id: DemoId): File => {
  const rate = 48000, size = 60 * rate;
  const left = new Float32Array(size), right = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const t = i / rate, phase = t % 4;
    const envelope = Math.exp(-(id === 'reverse' ? 4 - phase : phase) * 2.6);
    const fade = Math.min(1, t / 0.02, (60 - t) / 0.1);
    const bell = (Math.sin(2 * Math.PI * 440 * t) + 0.4 * Math.sin(2 * Math.PI * 1109 * t) + 0.14 * Math.sin(2 * Math.PI * 2903 * t)) * 0.2 * envelope;
    const bed = Math.sin(2 * Math.PI * 110 * t) * 0.012;
    left[i] = (bell + bed) * fade;
    right[i] = (bell * 0.86 + Math.sin(2 * Math.PI * 165 * t) * 0.01) * fade;
  }
  if (id === 'clicks') for (const t of [12, 28, 43]) left[t * rate + 1200] += 0.6;
  if (id === 'clipping') for (let i = 20 * rate; i < 21 * rate; i++) { left[i] = Math.max(-1, Math.min(32767 / 32768, left[i] * 30)); right[i] = Math.max(-1, Math.min(32767 / 32768, right[i] * 30)); }
  return new File([encodeWav16([left, right], rate)], DEMOS.find(d => d.id === id)!.name, { type: 'audio/wav' });
};
