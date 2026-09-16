import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURES_VERSION } from '../services/audio/features';
import { DESCRIPTOR_VERSION } from '../services/learning/descriptors';

/**
 * Guardián: si alguien sube FEATURES_VERSION sin regenerar el corpus (`npm run corpus:build`,
 * sin red), la vista Muestras y el entrenamiento en CI dejarían de funcionar. Esta prueba lo
 * convierte en un fallo visible antes de llegar a main.
 */
describe('El corpus publicado va en la versión del código', () => {
  it('todos los registros de coleccion.json', () => {
    const collection = JSON.parse(fs.readFileSync('public/corpus/coleccion.json', 'utf8')) as { records: { features: { version: string; analysis: { version: string } } }[] };
    const versions = new Set(collection.records.flatMap(r => [r.features.version, r.features.analysis.version]));
    expect([...versions]).toEqual([FEATURES_VERSION]);
  });

  it('el modelo publicado usa los descriptores actuales', () => {
    const model = JSON.parse(fs.readFileSync('public/corpus/modelo.json', 'utf8')) as { featureVersion: string };
    expect(model.featureVersion).toBe(DESCRIPTOR_VERSION);
  });
});
