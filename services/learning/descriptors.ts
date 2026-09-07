import { FEATURES_VERSION, type AudioFeatures } from '../audio/features';

export const DESCRIPTOR_VERSION = `${FEATURES_VERSION}/spectrum-temporal-v2`;
const finite = (x: number, fallback = 0) => Number.isFinite(x) ? x : fallback;
const bound = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));

/**
 * Descriptores del modelo local. Rejilla física fija de 48 bandas (30 Hz–16 kHz) del espectro
 * promedio, más dinámica global y, desde v2, descriptores temporales: asimetría de envolvente
 * (reversa), periodicidad y repeticiones casi idénticas (loops), cresta del flujo espectral
 * (transitorios emborronados por time stretch). Nunca se usan nombre, duración ni contenedor.
 */
export const describeAudio = (f: AudioFeatures): number[] => {
  if (f.version !== FEATURES_VERSION) throw new Error('Versión de características incompatible. Reanaliza las muestras.');
  if (!f.spectrum || f.spectrum.ltas.length !== 48 || !Number.isFinite(f.format.duration) || f.format.duration <= 0) throw new Error('Métricas incompletas para entrenar.');
  if (!f.temporal) throw new Error('Faltan los descriptores temporales. Reanaliza las muestras.');
  const bands = f.spectrum.ltas;
  if (bands.some(b => !Number.isFinite(b.hz) || b.hz < 0 || Number.isNaN(b.db))) throw new Error('Espectro inválido.');
  const values = Array.from({ length: 48 }, (_, i) => {
    const hz = 30 * (16000 / 30) ** (i / 47);
    const upper = bands.findIndex(b => b.hz >= hz);
    if (upper < 0) return -1;
    const high = bands[upper], low = bands[Math.max(0, upper - 1)];
    const fraction = high.hz === low.hz ? 0 : (hz - low.hz) / (high.hz - low.hz);
    return bound((finite(low.db, -120) * (1 - fraction) + finite(high.db, -120) * fraction) / 120, -1, 0);
  });
  const t = f.temporal;
  return [...values,
    Math.log10(1 + finite(f.spectrum.centroidHz)) / 5,
    Math.log10(1 + finite(f.spectrum.rolloff95Hz)) / 5,
    bound(finite(f.spectrum.flatness), 0, 1),
    bound(finite(f.levels.crestFactorDb) / 40, 0, 1),
    bound(finite(f.levels.loudnessRangeLu) / 30, 0, 1),
    bound(finite(f.silence.silentRatio), 0, 1),
    bound(f.heuristics.reverseEnvelopeEvents / f.format.duration, 0, 1),
    bound(finite(t.onsetRate) / 20, 0, 1),
    bound((finite(t.envelopeAsymmetry) + 1) / 2, 0, 1),
    bound(finite(t.reverseLikeFraction), 0, 1),
    bound(finite(t.periodicityStrength), 0, 1),
    bound(finite(t.periodicityLagSec) / 4, 0, 1),
    bound(finite(t.repeatFraction), 0, 1),
    bound(finite(t.repeatLagSec) / 4, 0, 1),
    bound(Math.log10(1 + finite(t.fluxCrest)) / 2, 0, 1),
  ];
};
