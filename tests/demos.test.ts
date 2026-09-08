import { describe, it, expect } from 'vitest';
import { createDemo } from '../services/audio/demos';
import { decodePcm } from '../services/audio/wav';
import { extractFeatures } from '../services/audio/features';

const analyze = async (id: Parameters<typeof createDemo>[0]) => extractFeatures(decodePcm(await createDemo(id).arrayBuffer())!);

describe('Demos sintéticas', () => {
  it('la demo limpia no tiene clics ni cortes: los ataques de la campana tienen rampa', async () => {
    const f = await analyze('clean');
    expect(f.clicks.count + f.clicks.discontinuities).toBe(0);
    expect(f.clipping.detected).toBe(false);
  }, 60000);
  it('la demo de clics contiene exactamente los tres impulsos anunciados', async () => {
    const f = await analyze('clicks');
    expect(f.clicks.count + f.clicks.discontinuities).toBe(3);
    const times = f.clicks.events.map((e) => e.time);
    [12.025, 28.025, 43.025].forEach((t, i) => expect(times[i]).toBeCloseTo(t, 2));
  }, 60000);
  it('la demo saturada satura y la de reversa no añade clics', async () => {
    expect((await analyze('clipping')).clipping.detected).toBe(true);
    const rev = await analyze('reverse');
    expect(rev.clicks.count + rev.clicks.discontinuities).toBe(0);
  }, 90000);
});
