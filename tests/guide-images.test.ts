import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STUDENT_STEPS, TEACHER_STEPS, guideUrl } from '../components/GuideView';

/**
 * Guardián: cada imagen que cita la guía tiene que existir en public/guia. Se regeneran con
 * `npm run guia:capturas`; una referencia rota aquí es una imagen rota en la web.
 */
describe('Imágenes de las guías', () => {
  const referenced = [...TEACHER_STEPS, ...STUDENT_STEPS].flatMap(s => s.images ?? []);

  it('la guía cita imágenes', () => {
    expect(referenced.length).toBeGreaterThan(10);
  });

  it('todas existen en public/guia y no están vacías', () => {
    const missing = referenced.filter(file => { const p = path.join('public/guia', file); return !fs.existsSync(p) || fs.statSync(p).size < 10_000; });
    expect(missing).toEqual([]);
  });

  it('no hay imágenes huérfanas en public/guia', () => {
    const onDisk = fs.readdirSync('public/guia').filter(f => f.endsWith('.png'));
    const orphans = onDisk.filter(f => !referenced.includes(f));
    expect(orphans).toEqual([]);
  });

  it('las URL respetan la ruta base del despliegue', () => {
    expect(guideUrl('a.png', '/sonora/')).toBe('/sonora/guia/a.png');
    expect(guideUrl('a.png', '/sonora')).toBe('/sonora/guia/a.png');
    expect(guideUrl('a.png', '/')).toBe('/guia/a.png');
  });
});
