/**
 * Qué versiones de características puede leer este código y cuáles puede entrenar.
 *
 * Mayor: cambia la forma (campos que desaparecen o cambian de tipo). Menor: campos nuevos, que
 * entran como opcionales en el esquema. Parche: mismos campos, recalculados con otro algoritmo.
 *
 * Leer acepta la misma mayor con menor ≤ la actual. Entrenar exige la versión exacta: mezclar
 * mediciones de dos algoritmos en un mismo entrenamiento contaminaría los datos sin que se note.
 */
import { FEATURES_VERSION } from './features';

export interface FeatureVersion { major: number; minor: number; patch: number }

export const parseFeatureVersion = (version: string): FeatureVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
};

const CURRENT = parseFeatureVersion(FEATURES_VERSION)!;

export const acceptsFeatureVersion = (version: string): boolean => {
  const parsed = parseFeatureVersion(version);
  return !!parsed && parsed.major === CURRENT.major && parsed.minor <= CURRENT.minor;
};

export const isCurrentFeatures = (features: { version: string }): boolean => features.version === FEATURES_VERSION;
