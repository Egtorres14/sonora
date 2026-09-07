/**
 * Extracción de características objetivas a partir de audio decodificado.
 * Puro (sin DOM): se ejecuta en un Web Worker o en Node (tests).
 */
import {
  measureLoudness, measureTruePeak, detectClipping, detectClicks, measureDcOffset,
  analyzeSilence, analyzeStereo, analyzeSpectrum, detectReverseEnvelopes, analyzeTemporal, downmixMono, dB,
  type ClickEvent, type SilenceResult, type StereoResult, type SpectralResult, type TemporalResult,
} from './dsp';
import type { DecodedAudio } from './wav';

export const FEATURES_VERSION = '2.1.0';

export interface AudioFeatures {
  version: string;
  file: { name: string; sizeBytes: number; container: string; decoder: string };
  format: {
    sampleRate: number;
    bitDepth: number; // 0 = desconocido
    sampleFormat: 'int' | 'float' | 'unknown';
    channels: number;
    duration: number;
    formatTag?: number | string;
  };
  levels: {
    samplePeakDbfs: number;
    truePeakDbtp: number;
    integratedLufs: number;
    shortTermMaxLufs: number;
    momentaryMaxLufs: number;
    loudnessRangeLu: number;
    crestFactorDb: number;
    dcOffset: number[];
    dcOffsetWarning: boolean;
  };
  clipping: {
    detected: boolean;
    runCount: number;
    clippedSamples: number;
    floatOvers: number;
    timestamps: number[]; // segundos, máx. 50
    interSampleOvers: boolean; // true peak > −1 dBTP
  };
  clicks: {
    count: number;
    discontinuities: number;
    events: ClickEvent[]; // máx. 100, ordenados por tiempo
  };
  silence: SilenceResult;
  stereo: StereoResult | null;
  spectrum: SpectralResult;
  /** Envolvente, periodicidad y repeticiones (v2.1). */
  temporal: TemporalResult;
  heuristics: {
    reverseEnvelopeEvents: number;
    reverseEnvelopeTimes: number[];
    /** Estimación de si el contenido real supera 16 kHz (si no, sospecha de fuente 32 k/MP3 remuestreada). */
    contentAbove16k: boolean;
  };
  analysis: { version: string; elapsedMs: number; warnings: string[] };
}

export interface FeatureOptions { fileName?: string; sizeBytes?: number }

export const extractFeatures = (audio: DecodedAudio, opts: FeatureOptions = {}): AudioFeatures => {
  const t0 = Date.now();
  const warnings: string[] = [];
  const { channels, sampleRate, bitDepth, sampleFormat, duration } = audio;
  if (channels.length === 0 || channels[0].length === 0) throw new Error('Audio vacío: no hay muestras que analizar.');
  if (audio.decoder === 'webaudio') warnings.push('Decodificado vía Web Audio: el sample rate y la profundidad de bits pueden no ser los originales.');
  if (bitDepth === 0) warnings.push('Profundidad de bits desconocida: el umbral de clipping usa −0.01 dBFS.');

  const mono = downmixMono(channels);
  const loud = measureLoudness(channels, sampleRate);
  const tp = measureTruePeak(channels, sampleRate);
  const clip = detectClipping(channels, sampleRate, { bitDepth, sampleFormat });
  const clicks = detectClicks(channels, sampleRate, { excludeRanges: clip.runs.map((r) => ({ start: r.start, end: r.end })) });
  const dc = measureDcOffset(channels);
  const silence = analyzeSilence(channels, sampleRate);
  const stereo = channels.length >= 2 ? analyzeStereo(channels[0], channels[1]) : null;
  const spectrum = analyzeSpectrum(mono, sampleRate);
  const reverse = detectReverseEnvelopes(mono, sampleRate);
  const temporal = analyzeTemporal(mono, sampleRate);

  let rmsSum = 0; for (let i = 0; i < mono.length; i++) rmsSum += mono[i] * mono[i];
  const rmsDb = dB(Math.sqrt(rmsSum / mono.length));

  const clipTimes = clip.runs.slice(0, 50).map((r) => +(r.start / sampleRate).toFixed(3));

  return {
    version: FEATURES_VERSION,
    file: { name: opts.fileName ?? '', sizeBytes: opts.sizeBytes ?? 0, container: audio.container, decoder: audio.decoder },
    format: { sampleRate, bitDepth, sampleFormat, channels: channels.length, duration: +duration.toFixed(3), formatTag: audio.formatTag },
    levels: {
      samplePeakDbfs: tp.samplePeakDbfs,
      truePeakDbtp: tp.dbtp,
      integratedLufs: Number.isFinite(loud.integrated) ? +loud.integrated.toFixed(1) : -Infinity,
      shortTermMaxLufs: Number.isFinite(loud.shortTermMax) ? +loud.shortTermMax.toFixed(1) : -Infinity,
      momentaryMaxLufs: Number.isFinite(loud.momentaryMax) ? +loud.momentaryMax.toFixed(1) : -Infinity,
      loudnessRangeLu: loud.range,
      crestFactorDb: +(tp.samplePeakDbfs - rmsDb).toFixed(1),
      dcOffset: dc,
      dcOffsetWarning: dc.some((v) => Math.abs(v) > 0.01),
    },
    clipping: {
      detected: clip.detected,
      runCount: clip.runCount,
      clippedSamples: clip.clippedSamples,
      floatOvers: clip.floatOvers,
      timestamps: clipTimes,
      interSampleOvers: tp.dbtp > -1.0,
    },
    clicks: {
      count: clicks.filter((c) => c.kind === 'click').length,
      discontinuities: clicks.filter((c) => c.kind === 'discontinuity').length,
      events: clicks.slice(0, 100),
    },
    silence,
    stereo,
    spectrum,
    temporal,
    heuristics: {
      reverseEnvelopeEvents: reverse.count,
      reverseEnvelopeTimes: reverse.events.slice(0, 20).map((e) => e.peak),
      contentAbove16k: spectrum.energyAbove16kDb > -60,
    },
    analysis: { version: FEATURES_VERSION, elapsedMs: Date.now() - t0, warnings },
  };
};

/** Formatea segundos como M:SS.mmm para timestamps legibles. */
export const formatTimestamp = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
};

/** Sustituye ±Infinity por null para poder serializar a JSON. */
export const serializableFeatures = (f: AudioFeatures): unknown =>
  JSON.parse(JSON.stringify(f, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
