import { z } from 'zod';
import { FEATURES_VERSION } from './audio/features';

const n = z.number().finite();
const nonnegative = n.nonnegative();
const count = nonnegative.int();
const ratio = n.min(0).max(1);
// Legacy null represented silence. New exports preserve both infinity signs.
const db = z.union([n, z.literal('Infinity'), z.literal('-Infinity'), z.null()]).transform(v => v === 'Infinity' ? Infinity : v === '-Infinity' || v === null ? -Infinity : v);
const text = z.string().max(20_000);
const label = z.enum(['unknown', 'present', 'absent']);
const labels = z.object({ pitch_shift: label, time_stretch: label, reversa: label, filtros: label, loops: label });
const evidence = z.object({ pitch_shift: text, time_stretch: text, reversa: text, filtros: text, loops: text });

const features = z.object({
  version: z.literal(FEATURES_VERSION),
  file: z.object({ name: text, sizeBytes: count, container: text, decoder: text }),
  format: z.object({ sampleRate: n.int().min(8000).max(384000), bitDepth: count.max(64), sampleFormat: z.enum(['int', 'float', 'unknown']), channels: count.min(1).max(32), duration: n.positive().max(86400), formatTag: z.union([n, text]).optional() }),
  levels: z.object({ samplePeakDbfs: db, truePeakDbtp: db, integratedLufs: db, shortTermMaxLufs: db, momentaryMaxLufs: db, loudnessRangeLu: nonnegative, crestFactorDb: db, dcOffset: z.array(n).max(32), dcOffsetWarning: z.boolean() }),
  clipping: z.object({ detected: z.boolean(), runCount: count, clippedSamples: count, floatOvers: count, timestamps: z.array(nonnegative).max(1000), interSampleOvers: z.boolean() }),
  clicks: z.object({ count, discontinuities: count, events: z.array(z.object({ time: nonnegative, channel: n.int().min(-1).max(31), durationMs: nonnegative, prominenceDb: db, kind: z.enum(['click', 'discontinuity']), confidence: ratio })).max(1000) }),
  silence: z.object({ leadingSec: nonnegative, trailingSec: nonnegative, gaps: z.array(z.object({ start: nonnegative, end: nonnegative })).max(10000), silentRatio: ratio, thresholdDbfs: n }),
  stereo: z.object({ correlation: n.min(-1).max(1), balanceDb: db, sideToMidDb: db, isDualMono: z.boolean() }).nullable(),
  spectrum: z.object({ centroidHz: nonnegative, rolloff95Hz: nonnegative, bandwidthHz: nonnegative, energyAbove16kDb: db, energyAbove20kDb: db, flatness: ratio, ltas: z.array(z.object({ hz: nonnegative, db })).length(48) }),
  temporal: z.object({ onsetRate: nonnegative, envelopeAsymmetry: n.min(-1).max(1), reverseLikeFraction: ratio, periodicityStrength: ratio, periodicityLagSec: nonnegative, repeatFraction: ratio, repeatLagSec: nonnegative, fluxCrest: nonnegative }),
  heuristics: z.object({ reverseEnvelopeEvents: count, reverseEnvelopeTimes: z.array(nonnegative).max(1000), contentAbove16k: z.boolean() }),
  analysis: z.object({ version: z.literal(FEATURES_VERSION), elapsedMs: nonnegative, warnings: z.array(text).max(100) }),
});

export const ReviewSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().min(1).max(500),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), features,
  origin: z.enum(['real', 'synthetic']), sourceGroup: z.string().max(200), labels, evidence,
  synopsis: text, context: text, notes: text,
  overprocessing: z.enum(['unknown', 'none', 'Leve', 'Moderado', 'Severo']), extra: label,
  manualScore: n.min(0).max(30.5).nullable(),
});
export const DatasetSchema = z.object({ version: z.literal(1), records: z.array(ReviewSchema).max(10000) });
