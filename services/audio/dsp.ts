/**
 * DSP defendible para el evaluador.
 *
 *  - Sonoridad según ITU-R BS.1770-4 / EBU R128 (ponderación K, bloques de 400 ms,
 *    puerta absoluta −70 LUFS y relativa −10 LU, LRA según EBU Tech 3342).
 *  - True peak con sobremuestreo ×4 (Annex 2 de BS.1770-4, FIR polifásico).
 *  - Clipping por rachas de muestras a fondo de escala (no por un único pico).
 *  - Clics/discontinuidades por residuo de predicción lineal (LPC) con umbral
 *    robusto (MAD) y pruebas anti-falsos-positivos para transitorios musicales.
 *  - DC offset, silencio, correlación estéreo, estadísticas espectrales y un
 *    heurístico de envolventes "en reversa".
 *
 * Todo el módulo es puro (sin DOM) para poder ejecutarse en un Web Worker y en
 * tests de Node.
 */

// ---------------------------------------------------------------------------
// Utilidades básicas
// ---------------------------------------------------------------------------

export const dB = (linear: number): number => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);
export const dBPower = (power: number): number => (power > 0 ? 10 * Math.log10(power) : -Infinity);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const downmixMono = (channels: Float32Array[]): Float32Array => {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const g = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * g;
  return out;
};

const rmsOf = (x: Float32Array, start: number, end: number): number => {
  start = Math.max(0, start); end = Math.min(x.length, end);
  if (end <= start) return 0;
  let s = 0;
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return Math.sqrt(s / (end - start));
};

const median = (arr: Float32Array | number[]): number => {
  if (arr.length === 0) return 0;
  const copy = Float32Array.from(arr).sort();
  const mid = copy.length >> 1;
  return copy.length % 2 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
};

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

// ---------------------------------------------------------------------------
// Biquad (forma directa II transpuesta)
// ---------------------------------------------------------------------------

export class Biquad {
  constructor(
    public readonly b0: number, public readonly b1: number, public readonly b2: number,
    public readonly a1: number, public readonly a2: number,
  ) {}

  process(x: Float32Array): Float32Array {
    const y = new Float32Array(x.length);
    let z1 = 0, z2 = 0;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = b0 * xi + z1;
      z1 = b1 * xi - a1 * yi + z2;
      z2 = b2 * xi - a2 * yi;
      y[i] = yi;
    }
    return y;
  }
}

/**
 * Filtros de ponderación K (BS.1770-4) para cualquier frecuencia de muestreo.
 * Derivación de coeficientes tomada del diseño analógico equivalente
 * (la misma que usa pyloudnorm); a 48 kHz reproduce exactamente las tablas del estándar.
 */
export const kWeightingFilters = (fs: number): { shelf: Biquad; highPass: Biquad } => {
  // Etapa 1: high shelf (+4 dB aprox. por encima de ~1.7 kHz)
  {
    var G = 3.999843853973347, Q = 0.7071752369554196, fc = 1681.974450955533;
    var K = Math.tan(Math.PI * fc / fs);
    var Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.499666774155);
    var a0 = 1 + K / Q + K * K;
    var shelf = new Biquad(
      (Vh + Vb * K / Q + K * K) / a0,
      2 * (K * K - Vh) / a0,
      (Vh - Vb * K / Q + K * K) / a0,
      2 * (K * K - 1) / a0,
      (1 - K / Q + K * K) / a0,
    );
  }
  // Etapa 2: high-pass (~38 Hz, Q 0.5)
  {
    var Q2 = 0.5003270373238773, fc2 = 38.13547087602444;
    var K2 = Math.tan(Math.PI * fc2 / fs);
    var d = 1 + K2 / Q2 + K2 * K2;
    var highPass = new Biquad(1, -2, 1, 2 * (K2 * K2 - 1) / d, (1 - K2 / Q2 + K2 * K2) / d);
  }
  return { shelf, highPass };
};

export const applyKWeighting = (x: Float32Array, fs: number): Float32Array => {
  const { shelf, highPass } = kWeightingFilters(fs);
  return highPass.process(shelf.process(x));
};

// ---------------------------------------------------------------------------
// Sonoridad integrada, momentánea, short-term y LRA
// ---------------------------------------------------------------------------

export interface LoudnessResult {
  /** LUFS integrado con doble puerta. −Infinity si todo queda por debajo de la puerta absoluta. */
  integrated: number;
  momentaryMax: number; // LUFS, ventana 400 ms
  shortTermMax: number; // LUFS, ventana 3 s
  range: number; // LRA en LU (EBU Tech 3342)
  blockCount: number;
}

const channelWeights = (n: number): number[] => {
  if (n === 6) return [1, 1, 1, 0, 1.41, 1.41]; // L R C LFE Ls Rs
  if (n === 5) return [1, 1, 1, 1.41, 1.41];
  return new Array(n).fill(1);
};

export const measureLoudness = (channels: Float32Array[], fs: number): LoudnessResult => {
  const n = channels[0].length;
  const G = channelWeights(channels.length);
  // Sumas prefijas de la potencia ponderada por canal
  const prefixes = channels.map((ch) => {
    const y = applyKWeighting(ch, fs);
    const p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + y[i] * y[i];
    return p;
  });
  const power = (start: number, end: number): number => {
    let s = 0;
    for (let c = 0; c < channels.length; c++) s += G[c] * (prefixes[c][end] - prefixes[c][start]) / (end - start);
    return s;
  };
  const toLufs = (p: number) => -0.691 + dBPower(p);

  const gated = (windowSec: number, relGateLu: number) => {
    const win = Math.min(n, Math.round(windowSec * fs));
    const hop = Math.max(1, Math.round(0.1 * fs));
    const powers: number[] = [];
    for (let start = 0; start + win <= n; start += hop) powers.push(power(start, start + win));
    if (powers.length === 0 && n > 0) powers.push(power(0, n));
    const lufs = powers.map(toLufs);
    const absIdx = lufs.map((l, i) => (l > -70 ? i : -1)).filter((i) => i >= 0);
    if (absIdx.length === 0) return { lufs, gatedIdx: [] as number[], integrated: -Infinity };
    const meanAbs = absIdx.reduce((s, i) => s + powers[i], 0) / absIdx.length;
    const relGate = toLufs(meanAbs) + relGateLu;
    const gatedIdx = absIdx.filter((i) => lufs[i] > relGate);
    const meanRel = gatedIdx.reduce((s, i) => s + powers[i], 0) / Math.max(1, gatedIdx.length);
    return { lufs, gatedIdx, integrated: gatedIdx.length ? toLufs(meanRel) : -Infinity };
  };

  const m = gated(0.4, -10);
  const s = gated(3.0, -20);
  let range = 0;
  if (s.gatedIdx.length >= 2) {
    const vals = s.gatedIdx.map((i) => s.lufs[i]).sort((a, b) => a - b);
    range = percentile(vals, 0.95) - percentile(vals, 0.10);
  }
  return {
    integrated: m.integrated,
    momentaryMax: m.lufs.length ? Math.max(...m.lufs) : -Infinity,
    shortTermMax: s.lufs.length ? Math.max(...s.lufs) : -Infinity,
    range: +range.toFixed(2),
    blockCount: m.lufs.length,
  };
};

// ---------------------------------------------------------------------------
// True peak (sobremuestreo con FIR polifásico windowed-sinc)
// ---------------------------------------------------------------------------

export interface TruePeakResult {
  dbtp: number;
  samplePeakDbfs: number;
  oversampling: number;
  channelDbtp: number[];
}

const blackmanHarris = (i: number, N: number): number => {
  const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
  const x = (2 * Math.PI * i) / (N - 1);
  return a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
};

const designPolyphase = (L: number, tapsPerPhase: number): Float64Array[] => {
  const N = L * tapsPerPhase;
  const center = (N - 1) / 2;
  const h = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const t = (j - center) / L;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    h[j] = sinc * blackmanHarris(j, N);
  }
  const phases: Float64Array[] = [];
  for (let phi = 0; phi < L; phi++) {
    const p = new Float64Array(tapsPerPhase);
    let sum = 0;
    for (let k = 0; k < tapsPerPhase; k++) { p[k] = h[phi + L * k]; sum += p[k]; }
    for (let k = 0; k < tapsPerPhase; k++) p[k] /= sum; // ganancia unidad por fase
    phases.push(p);
  }
  return phases;
};

export const measureTruePeak = (channels: Float32Array[], fs: number): TruePeakResult => {
  const L = fs >= 96000 ? 2 : 4;
  const tapsPerPhase = 12;
  const phases = designPolyphase(L, tapsPerPhase);
  let samplePeak = 0;
  const channelDbtp: number[] = [];
  let globalPeak = 0;
  for (const x of channels) {
    let peak = 0;
    const n = x.length;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
      if (a > samplePeak) samplePeak = a;
    }
    for (let i = 0; i < n; i++) {
      for (let phi = 0; phi < L; phi++) {
        const p = phases[phi];
        let acc = 0;
        for (let k = 0; k < tapsPerPhase; k++) {
          const idx = i - k;
          if (idx >= 0) acc += p[k] * x[idx];
        }
        const a = Math.abs(acc);
        if (a > peak) peak = a;
      }
    }
    channelDbtp.push(+dB(peak).toFixed(2));
    if (peak > globalPeak) globalPeak = peak;
  }
  return { dbtp: +dB(globalPeak).toFixed(2), samplePeakDbfs: +dB(samplePeak).toFixed(2), oversampling: L, channelDbtp };
};

// ---------------------------------------------------------------------------
// Clipping
// ---------------------------------------------------------------------------

export interface ClippingRun { start: number; end: number; channel: number; samples: number }
export interface ClippingResult {
  detected: boolean;
  runs: ClippingRun[];
  runCount: number;
  clippedSamples: number;
  threshold: number;
  minRun: number;
  /** Muestras > 1.0 en archivos float (se recortarían al exportar a entero). */
  floatOvers: number;
}

export const detectClipping = (
  channels: Float32Array[], fs: number,
  opts: { bitDepth?: number; sampleFormat?: 'int' | 'float' | 'unknown'; minRun?: number } = {},
): ClippingResult => {
  const { bitDepth = 0, sampleFormat = 'unknown' } = opts;
  const minRun = opts.minRun ?? (fs >= 88200 ? 6 : 3);
  // Enteros: fondo de escala positivo exacto (2^(b-1)-1)/2^(b-1). Float/desconocido: −0.01 dBFS.
  const threshold = sampleFormat === 'int' && bitDepth > 0 ? (2 ** (bitDepth - 1) - 1) / 2 ** (bitDepth - 1) - 1e-7 : 0.99885;
  const runs: ClippingRun[] = [];
  let clippedSamples = 0, floatOvers = 0;
  channels.forEach((x, c) => {
    let runStart = -1;
    for (let i = 0; i <= x.length; i++) {
      const at = i < x.length && Math.abs(x[i]) >= threshold;
      if (i < x.length && Math.abs(x[i]) > 1.0) floatOvers++;
      if (at && runStart < 0) runStart = i;
      if (!at && runStart >= 0) {
        const len = i - runStart;
        if (len >= minRun) { runs.push({ start: runStart, end: i, channel: c, samples: len }); clippedSamples += len; }
        runStart = -1;
      }
    }
  });
  runs.sort((a, b) => a.start - b.start);
  return { detected: runs.length > 0 || floatOvers > 0, runs, runCount: runs.length, clippedSamples, threshold, minRun, floatOvers };
};

// ---------------------------------------------------------------------------
// Clics y discontinuidades (residuo LPC + umbral robusto)
// ---------------------------------------------------------------------------

export interface ClickEvent {
  time: number; // segundos
  channel: number; // −1 si aparece en varios canales
  durationMs: number;
  prominenceDb: number; // residuo pico / escala robusta local
  kind: 'click' | 'discontinuity';
  confidence: number; // 0..1
}

/** Levinson-Durbin: devuelve coeficientes a[1..p] tales que x̂[n] = Σ a[k]·x[n−k]. */
const levinson = (r: Float64Array, p: number): Float64Array => {
  const a = new Float64Array(p + 1);
  let err = r[0];
  const tmp = new Float64Array(p + 1);
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc -= a[j] * r[i - j];
    const k = err > 1e-20 ? acc / err : 0;
    tmp.set(a);
    a[i] = k;
    for (let j = 1; j < i; j++) a[j] = tmp[j] - k * tmp[i - j];
    err *= 1 - k * k;
    if (err <= 1e-20) break;
  }
  return a;
};

export const lpcResidual = (x: Float32Array, order: number, frame: number): Float32Array => {
  const n = x.length;
  const e = new Float32Array(n);
  const r = new Float64Array(order + 1);
  const windowed = new Float64Array(frame);
  const hann = (len: number) => { const w = new Float64Array(len); for (let i = 0; i < len; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len); return w; };
  const fullWindow = hann(frame);
  for (let start = 0; start < n; start += frame) {
    const end = Math.min(n, start + frame);
    const len = end - start;
    const w = len === frame ? fullWindow : hann(len);
    for (let i = 0; i < len; i++) windowed[i] = x[start + i] * w[i];
    r.fill(0);
    for (let lag = 0; lag <= order; lag++) {
      let acc = 0;
      for (let i = lag; i < len; i++) acc += windowed[i] * windowed[i - lag];
      r[lag] = acc;
    }
    if (r[0] < 1e-12) { for (let i = start; i < end; i++) e[i] = x[i]; continue; }
    r[0] *= 1 + 1e-6; // regularización (ruido blanco) para señales casi deterministas
    const a = levinson(r, order);
    for (let i = start; i < end; i++) {
      if (i < order) { e[i] = 0; continue; } // sin historial: no se puede predecir
      let pred = 0;
      for (let k = 1; k <= order; k++) pred += a[k] * x[i - k];
      e[i] = x[i] - pred;
    }
  }
  return e;
};

/**
 * Discontinuidades de edición (cortes sin crossfade): salto muestra-a-muestra anómalo
 * respecto a la variación típica del material ANTERIOR y POSTERIOR. Un ataque natural
 * (percusión) es anómalo respecto al "antes" pero típico respecto al "después", así que
 * no se marca; un corte entre dos materiales suaves sí.
 */
export const detectDiscontinuities = (x: Float32Array, fs: number, opts: { ratio?: number; absFloor?: number } = {}): { index: number; ratio: number }[] => {
  const { ratio = 8, absFloor = 2e-3 } = opts;
  const n = x.length;
  const block = Math.max(64, Math.round(0.02 * fs));
  const diff = new Float32Array(n);
  for (let i = 1; i < n; i++) diff[i] = Math.abs(x[i] - x[i - 1]);
  // Escala robusta (MAD) de la diferencia primera por bloques de 20 ms
  const nBlocks = Math.ceil(n / block);
  const blockScale = new Float64Array(nBlocks);
  for (let b = 0; b < nBlocks; b++) blockScale[b] = 1.4826 * median(diff.subarray(b * block, Math.min(n, (b + 1) * block)));
  const out: { index: number; ratio: number }[] = [];
  const skip = Math.round(0.002 * fs);
  for (let i = 2; i < n - 1; i++) {
    const d = diff[i];
    if (d < absFloor || d < diff[i - 1] || d < diff[i + 1]) continue;
    const b = Math.floor(i / block);
    // el salto debe ser anómalo respecto al material de ANTES y de DESPUÉS
    const scale = Math.max(blockScale[Math.max(0, b - 1)], blockScale[b], blockScale[Math.min(nBlocks - 1, b + 1)], absFloor / ratio);
    const rt = d / scale;
    if (rt > ratio) { out.push({ index: i, ratio: rt }); i += skip; }
  }
  return out;
};

export const detectClicks = (
  channels: Float32Array[], fs: number,
  opts: { order?: number; frame?: number; k?: number; minProminenceDb?: number; maxDurationMs?: number; absFloor?: number; excludeRanges?: { start: number; end: number }[] } = {},
): ClickEvent[] => {
  const { order = 16, frame = 2048, k = 8, minProminenceDb = 18, maxDurationMs = 3, absFloor = 1e-4, excludeRanges = [] } = opts;
  const events: ClickEvent[] = [];
  const clusterGap = Math.round(0.002 * fs);
  const ctx = Math.round(0.02 * fs), guard = Math.round(0.002 * fs);
  // Zonas excluidas (p. ej. rachas de clipping, ya penalizadas): las "esquinas" de una onda recortada no son clics de edición
  const pad = Math.round(0.005 * fs);
  const excluded = (idx: number) => excludeRanges.some((r) => idx >= r.start - pad && idx <= r.end + pad);

  channels.forEach((x, c) => {
    const n = x.length;
    const e = lpcResidual(x, order, frame);
    const absE = new Float32Array(n);
    for (let i = 0; i < n; i++) absE[i] = Math.abs(e[i]);

    // Umbral robusto por frame LPC (así un clic no "contamina" el umbral de frames vecinos)
    for (let ws = 0; ws < n; ws += frame) {
      const we = Math.min(n, ws + frame);
      const sigma = 1.4826 * median(absE.subarray(ws, we));
      const thr = Math.max(k * sigma, absFloor);
      let i = ws;
      while (i < we) {
        if (absE[i] <= thr) { i++; continue; }
        const cStart = i;
        let cEnd = i, last = i, peak = absE[i], peakIdx = i;
        let j = i + 1;
        while (j < we && j - last <= clusterGap) {
          if (absE[j] > thr) { last = j; cEnd = j; if (absE[j] > peak) { peak = absE[j]; peakIdx = j; } }
          j++;
        }
        i = j;
        const durationMs = ((cEnd - cStart + 1) / fs) * 1000;
        const prominenceDb = dB(peak / Math.max(sigma, absFloor / k));
        if (durationMs > maxDurationMs || prominenceDb < minProminenceDb || excluded(peakIdx)) continue;

        // Prueba de cambio de nivel: un ataque/corte musical cambia el nivel tras el evento
        const before = rmsOf(x, cStart - guard - ctx, cStart - guard);
        const after = rmsOf(x, cEnd + guard, cEnd + guard + ctx);
        const levelChangeDb = before > 1e-6 && after > 1e-6 ? dB(after / before) : 0;
        if (Math.abs(levelChangeDb) > 6 && prominenceDb < 40) continue;

        const confidence = clamp((prominenceDb - minProminenceDb) / 30, 0.3, 1);
        events.push({ time: peakIdx / fs, channel: c, durationMs: +durationMs.toFixed(2), prominenceDb: +prominenceDb.toFixed(1), kind: 'click', confidence: +confidence.toFixed(2) });
      }
    }

    for (const d of detectDiscontinuities(x, fs)) {
      const t = d.index / fs;
      if (excluded(d.index) || events.some((ev) => ev.channel === c && Math.abs(ev.time - t) < 0.002)) continue;
      const confidence = clamp((d.ratio - 8) / 24, 0.4, 0.9);
      events.push({ time: t, channel: c, durationMs: +((1 / fs) * 1000).toFixed(3), prominenceDb: +dB(d.ratio).toFixed(1), kind: 'discontinuity', confidence: +confidence.toFixed(2) });
    }
  });

  // Fusionar eventos casi simultáneos entre canales
  events.sort((a, b) => a.time - b.time);
  const merged: ClickEvent[] = [];
  for (const ev of events) {
    const prev = merged[merged.length - 1];
    if (prev && ev.time - prev.time < 0.001) {
      if (ev.prominenceDb > prev.prominenceDb) Object.assign(prev, { ...ev, channel: -1 });
      else prev.channel = -1;
    } else merged.push({ ...ev });
  }
  return merged;
};

// ---------------------------------------------------------------------------
// DC offset, silencio, estéreo
// ---------------------------------------------------------------------------

export const measureDcOffset = (channels: Float32Array[]): number[] =>
  channels.map((x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return +(s / x.length).toFixed(5); });

export interface SilenceResult {
  leadingSec: number;
  trailingSec: number;
  gaps: { start: number; end: number }[];
  silentRatio: number;
  thresholdDbfs: number;
}

export const analyzeSilence = (channels: Float32Array[], fs: number, thresholdDbfs = -80, minGapSec = 0.1): SilenceResult => {
  const mono = downmixMono(channels);
  const hop = Math.max(1, Math.round(0.01 * fs));
  const frames = Math.ceil(mono.length / hop);
  const silent: boolean[] = new Array(frames);
  const thr = Math.pow(10, thresholdDbfs / 20);
  let silentCount = 0;
  for (let f = 0; f < frames; f++) {
    silent[f] = rmsOf(mono, f * hop, (f + 1) * hop) < thr;
    if (silent[f]) silentCount++;
  }
  let lead = 0; while (lead < frames && silent[lead]) lead++;
  let trail = 0; while (trail < frames - lead && silent[frames - 1 - trail]) trail++;
  const gaps: { start: number; end: number }[] = [];
  let gStart = -1;
  for (let f = lead; f < frames - trail; f++) {
    if (silent[f] && gStart < 0) gStart = f;
    if (!silent[f] && gStart >= 0) {
      if ((f - gStart) * hop / fs >= minGapSec) gaps.push({ start: +((gStart * hop) / fs).toFixed(3), end: +((f * hop) / fs).toFixed(3) });
      gStart = -1;
    }
  }
  return {
    leadingSec: +((lead * hop) / fs).toFixed(3),
    trailingSec: +((trail * hop) / fs).toFixed(3),
    gaps,
    silentRatio: +(silentCount / Math.max(1, frames)).toFixed(3),
    thresholdDbfs,
  };
};

export interface StereoResult {
  correlation: number; // −1..1 (Pearson L/R)
  balanceDb: number; // RMS L − RMS R en dB (positivo = más nivel a la izquierda)
  sideToMidDb: number; // energía S/M en dB (−Inf = mono)
  isDualMono: boolean;
}

export const analyzeStereo = (L: Float32Array, R: Float32Array): StereoResult => {
  const n = Math.min(L.length, R.length);
  let sl = 0, sr = 0, slr = 0, sll = 0, srr = 0, sm = 0, ss = 0, same = true;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = R[i];
    sl += l; sr += r; slr += l * r; sll += l * l; srr += r * r;
    const m = (l + r) / 2, s = (l - r) / 2; sm += m * m; ss += s * s;
    if (same && Math.abs(l - r) > 1e-6) same = false;
  }
  const cov = slr / n - (sl / n) * (sr / n);
  const vl = sll / n - (sl / n) ** 2, vr = srr / n - (sr / n) ** 2;
  const corr = vl > 0 && vr > 0 ? cov / Math.sqrt(vl * vr) : 1;
  return {
    correlation: +clamp(corr, -1, 1).toFixed(3),
    balanceDb: +(dB(Math.sqrt(sll / n)) - dB(Math.sqrt(srr / n))).toFixed(2),
    sideToMidDb: +(dBPower(ss) - dBPower(sm)).toFixed(2),
    isDualMono: same,
  };
};

// ---------------------------------------------------------------------------
// FFT y estadísticas espectrales
// ---------------------------------------------------------------------------

export const fftInPlace = (re: Float64Array, im: Float64Array): void => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
};

export interface SpectralResult {
  centroidHz: number;
  rolloff95Hz: number;
  /** Frecuencia más alta con energía a menos de 60 dB del máximo del LTAS. */
  bandwidthHz: number;
  energyAbove16kDb: number;
  energyAbove20kDb: number;
  flatness: number;
  /** Espectro promedio a largo plazo en 48 bandas log, dB relativos al máximo. */
  ltas: { hz: number; db: number }[];
}

export interface StftResult { frames: number; bins: number; hopSec: number; binHz: number; magnitudeDb: Float32Array[] }

export const stft = (mono: Float32Array, fs: number, fftSize = 2048, hop = 1024): StftResult => {
  const bins = fftSize / 2 + 1;
  const frames = Math.max(1, Math.floor((mono.length - fftSize) / hop) + 1);
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  const magnitudeDb: Float32Array[] = [];
  const norm = 2 / (fftSize * 0.5); // compensación de ventana Hann (ganancia coherente 0.5)
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < fftSize; i++) { re[i] = (mono[off + i] ?? 0) * window[i]; im[i] = 0; }
    fftInPlace(re, im);
    const row = new Float32Array(bins);
    for (let b = 0; b < bins; b++) row[b] = dB(Math.hypot(re[b], im[b]) * norm);
    magnitudeDb.push(row);
  }
  return { frames, bins, hopSec: hop / fs, binHz: fs / fftSize, magnitudeDb };
};

export const analyzeSpectrum = (mono: Float32Array, fs: number): SpectralResult => {
  const fftSize = 2048;
  const s = stft(mono, fs, fftSize, 1024);
  const bins = s.bins;
  const ltasPow = new Float64Array(bins);
  let centroidSum = 0, rolloffSum = 0, active = 0;
  for (const row of s.magnitudeDb) {
    let total = 0, weighted = 0;
    const pow = new Float64Array(bins);
    for (let b = 0; b < bins; b++) { const p = Math.pow(10, row[b] / 10); pow[b] = p; total += p; weighted += p * b * s.binHz; ltasPow[b] += p; }
    if (total < 1e-9) continue; // ~−90 dBFS: no cuenta para centroid/rolloff
    active++;
    centroidSum += weighted / total;
    let acc = 0, rb = 0;
    for (let b = 0; b < bins; b++) { acc += pow[b]; if (acc >= 0.95 * total) { rb = b; break; } }
    rolloffSum += rb * s.binHz;
  }
  const totalPow = ltasPow.reduce((a, b) => a + b, 0);
  const above = (hz: number) => { let e = 0; for (let b = Math.ceil(hz / s.binHz); b < bins; b++) e += ltasPow[b]; return totalPow > 0 ? dBPower(e / totalPow) : -Infinity; };
  const ltasDb = Array.from(ltasPow, (p) => dBPower(p / Math.max(1, s.frames)));
  const maxDb = Math.max(...ltasDb.filter(Number.isFinite));
  let bw = 0;
  for (let b = bins - 1; b >= 0; b--) if (ltasDb[b] >= maxDb - 60) { bw = b * s.binHz; break; }
  let logSum = 0, linSum = 0, cnt = 0;
  for (let b = 1; b < bins; b++) { const p = ltasPow[b] / Math.max(1, s.frames) + 1e-20; logSum += Math.log(p); linSum += p; cnt++; }
  const flatness = cnt ? Math.exp(logSum / cnt) / (linSum / cnt) : 0;
  const bands = 48, fMin = 20, fMax = fs / 2;
  const ltas: { hz: number; db: number }[] = [];
  for (let i = 0; i < bands; i++) {
    const lo = fMin * Math.pow(fMax / fMin, i / bands), hi = fMin * Math.pow(fMax / fMin, (i + 1) / bands);
    let e = 0, k = 0;
    for (let b = Math.floor(lo / s.binHz); b < Math.min(bins, Math.ceil(hi / s.binHz)); b++) { e += ltasPow[b]; k++; }
    const db = k ? dBPower(e / k / Math.max(1, s.frames)) - maxDb : -Infinity;
    ltas.push({ hz: Math.round(Math.sqrt(lo * hi)), db: Number.isFinite(db) ? +db.toFixed(1) : -120 });
  }
  return {
    centroidHz: Math.round(active ? centroidSum / active : 0),
    rolloff95Hz: Math.round(active ? rolloffSum / active : 0),
    bandwidthHz: Math.round(bw),
    energyAbove16kDb: +above(16000).toFixed(1),
    energyAbove20kDb: +above(20000).toFixed(1),
    flatness: +flatness.toFixed(4),
    ltas,
  };
};

// ---------------------------------------------------------------------------
// Heurístico: envolventes en reversa (crescendo largo + corte abrupto)
// ---------------------------------------------------------------------------

export interface ReverseEnvelopeResult { count: number; events: { start: number; peak: number; end: number }[] }

export const detectReverseEnvelopes = (mono: Float32Array, fs: number): ReverseEnvelopeResult => {
  const hop = Math.round(0.01 * fs);
  const frames = Math.floor(mono.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) env[f] = dB(rmsOf(mono, f * hop, (f + 1) * hop) + 1e-9);
  // suavizado ligero
  const sm = new Float32Array(frames);
  for (let f = 0; f < frames; f++) sm[f] = (env[Math.max(0, f - 1)] + env[f] + env[Math.min(frames - 1, f + 1)]) / 3;
  const events: ReverseEnvelopeResult['events'] = [];
  const drop = 12;
  for (let f = 1; f < frames - 1; f++) {
    if (!(sm[f] >= sm[f - 1] && sm[f] > sm[f + 1]) || sm[f] < -50) continue;
    // subida: hasta dónde hay que retroceder para bajar 12 dB
    let l = f; while (l > 0 && sm[f] - sm[l] < drop) l--;
    if (sm[f] - sm[l] < drop) continue;
    let r = f; while (r < frames - 1 && sm[f] - sm[r] < drop) r++;
    if (sm[f] - sm[r] < drop) continue;
    const riseSec = (f - l) * hop / fs, fallSec = (r - f) * hop / fs;
    if (riseSec >= 0.25 && fallSec <= 0.04) {
      events.push({ start: +((l * hop) / fs).toFixed(2), peak: +((f * hop) / fs).toFixed(2), end: +((r * hop) / fs).toFixed(2) });
      f = r;
    }
  }
  return { count: events.length, events };
};

// ---------------------------------------------------------------------------
// Descriptores temporales (envolvente, periodicidad y repeticiones)
// ---------------------------------------------------------------------------

export interface TemporalResult {
  /** Ataques por segundo (subidas ≥ 6 dB en la envolvente). */
  onsetRate: number;
  /** Media de (E_después − E_antes)/(E_después + E_antes) alrededor de los picos (300 ms). Natural > 0; reversa < 0. */
  envelopeAsymmetry: number;
  /** Fracción de picos con asimetría < −0.3 (crescendo largo + corte). */
  reverseLikeFraction: number;
  /** Pico máximo de la autocorrelación normalizada de la envolvente (lags 0.2–4 s). */
  periodicityStrength: number;
  periodicityLagSec: number;
  /** Fracción de frames casi idénticos (r ≥ 0.985 en la desviación espectral) a un frame anterior a un lag fijo; máximo sobre lags. */
  repeatFraction: number;
  repeatLagSec: number;
  /** Cresta (máx/media) del flujo espectral: transitorios nítidos ↑, emborronados ↓. */
  fluxCrest: number;
}

/** Autocorrelación normalizada por FFT de una señal decimada; devuelve r(lag) para lag ≥ 0. */
const autocorrelation = (x: Float32Array): Float64Array => {
  let N = 1; while (N < 2 * x.length) N <<= 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(x);
  fftInPlace(re, im);
  for (let i = 0; i < N; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
  fftInPlace(re, im); // la FFT de un espectro real y simétrico es la autocorrelación (salvo escala)
  const r0 = re[0] || 1;
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = re[i] / r0;
  return out;
};

/** Fracción de bloques de 20 ms cuya forma de onda coincide (r ≥ 0.98) con la del bloque situado `lag` muestras antes. */
const blockMatchFraction = (x: Float32Array, lag: number, block: number): number => {
  let hits = 0, valid = 0;
  const thr = 1e-4; // −80 dBFS de energía media
  for (let s = lag; s + block <= x.length; s += block) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < block; i++) { const a = x[s + i], b = x[s - lag + i]; ab += a * b; aa += a * a; bb += b * b; }
    if (aa / block < thr * thr || bb / block < thr * thr) continue;
    valid++;
    if (ab / Math.sqrt(aa * bb) >= 0.98) hits++;
  }
  return valid >= 5 ? hits / valid : 0;
};

export const analyzeTemporal = (mono: Float32Array, fs: number): TemporalResult => {
  const hop = Math.max(1, Math.round(0.01 * fs));
  const frames = Math.floor(mono.length / hop);
  const empty: TemporalResult = { onsetRate: 0, envelopeAsymmetry: 0, reverseLikeFraction: 0, periodicityStrength: 0, periodicityLagSec: 0, repeatFraction: 0, repeatLagSec: 0, fluxCrest: 0 };
  if (frames < 60) return empty;
  const env = new Float64Array(frames), envDb = new Float64Array(frames);
  for (let f = 0; f < frames; f++) { const r = rmsOf(mono, f * hop, (f + 1) * hop); env[f] = r; envDb[f] = 20 * Math.log10(r + 1e-9); }
  const sm = new Float64Array(frames);
  for (let f = 0; f < frames; f++) sm[f] = (envDb[Math.max(0, f - 1)] + envDb[f] + envDb[Math.min(frames - 1, f + 1)]) / 3;

  // Ataques: subida ≥ 6 dB en 50 ms, distancia mínima 100 ms
  let onsets = 0, last = -100;
  for (let f = 5; f < frames; f++) if (sm[f] - sm[f - 5] >= 6 && sm[f] > -50 && f - last >= 10) { onsets++; last = f; }
  const duration = mono.length / fs;

  // Asimetría temporal de cada pico: tiempo de subida y de caída hasta −6 dB (ventanas adaptativas, máx. 3 s).
  // Percusión natural: caída ≫ subida (ratio > 0). Invertida: subida ≫ caída (ratio < 0). Sostenido: ≈ 0.
  const ratios: number[] = [];
  let globalMax = -Infinity; for (let f = 0; f < frames; f++) if (sm[f] > globalMax) globalMax = sm[f];
  const cap = Math.min(300, frames);
  let lastPeak = -1000;
  for (let f = 15; f < frames - 15; f++) {
    if (sm[f] < -50 || sm[f] < globalMax - 30 || f - lastPeak < 20) continue;
    let isMax = true;
    for (let k = 1; k <= 15; k++) if (sm[f - k] > sm[f] || sm[f + k] > sm[f]) { isMax = false; break; }
    if (!isMax) continue;
    let rise = 0; while (rise < cap && f - rise > 0 && sm[f - rise] > sm[f] - 6) rise++;
    let fall = 0; while (fall < cap && f + fall < frames - 1 && sm[f + fall] > sm[f] - 6) fall++;
    if (rise >= cap || fall >= cap || rise + fall < 5) continue;
    ratios.push(Math.log2((fall + 1) / (rise + 1)));
    lastPeak = f;
  }
  const envelopeAsymmetry = ratios.length ? Math.tanh(ratios.reduce((x, y) => x + y, 0) / ratios.length / 3) : 0;
  const reverseLikeFraction = ratios.length ? ratios.filter((r) => r < -1).length / ratios.length : 0;

  // Periodicidad de la envolvente (autocorrelación normalizada, 0.2–4 s)
  const mean = env.reduce((a, b) => a + b, 0) / frames;
  const c = Float64Array.from(env, (v) => v - mean);
  let denom = 0; for (let f = 0; f < frames; f++) denom += c[f] * c[f];
  let periodicityStrength = 0, periodicityLagSec = 0;
  if (denom > 0) {
    for (let lag = 20; lag <= Math.min(400, frames - 20); lag++) {
      let acc = 0; for (let f = lag; f < frames; f++) acc += c[f] * c[f - lag];
      const r = acc / denom;
      if (r > periodicityStrength) { periodicityStrength = r; periodicityLagSec = (lag * hop) / fs; }
    }
  }

  // Repeticiones digitales (loops): lags candidatos por autocorrelación de la señal decimada,
  // y en cada candidato (afinado a ±dec muestras) fracción de bloques de 20 ms idénticos.
  let repeatFraction = 0, repeatLagSec = 0;
  {
    const dec = fs >= 32000 ? 4 : 2;
    const maxSec = Math.min(60, duration);
    const src = mono.length > maxSec * fs ? mono.subarray(0, Math.round(maxSec * fs)) : mono;
    const lp = filterVariableSimple(src, fs, 0.4 * fs / dec);
    const z = new Float32Array(Math.floor(lp.length / dec));
    for (let i = 0; i < z.length; i++) z[i] = lp[i * dec];
    if (z.length > 1024) {
      const r = autocorrelation(z);
      const zfs = fs / dec;
      const lo = Math.round(0.15 * zfs), hi = Math.min(Math.round(4 * zfs), Math.floor(z.length / 2));
      const sep = Math.round(0.01 * zfs);
      const peaks: { lag: number; r: number }[] = [];
      for (let l = lo + 1; l < hi - 1; l++) if (r[l] > r[l - 1] && r[l] >= r[l + 1] && r[l] > 0.05) peaks.push({ lag: l, r: r[l] });
      peaks.sort((a, b) => b.r - a.r);
      const chosen: number[] = [];
      for (const pk of peaks) { if (chosen.every((cl) => Math.abs(cl - pk.lag) > sep)) chosen.push(pk.lag); if (chosen.length >= 6) break; }
      const block = Math.round(0.02 * fs);
      for (const cl of chosen) {
        const base = cl * dec;
        for (let off = -dec; off <= dec; off++) {
          const lag = base + off;
          if (lag < block || lag >= src.length - block) continue;
          const frac = blockMatchFraction(src, lag, block);
          if (frac > repeatFraction) { repeatFraction = frac; repeatLagSec = lag / fs; }
        }
      }
    }
  }

  // Cresta del flujo espectral (32 bandas log, STFT 2048/1024)
  let fluxCrest = 0;
  {
    const s = stft(mono, fs, 2048, 1024);
    const nb = 32, fMin = 40, fMax = Math.min(16000, fs / 2);
    const edges = Array.from({ length: nb + 1 }, (_, i) => fMin * Math.pow(fMax / fMin, i / nb));
    let prev: Float64Array | null = null;
    const flux: number[] = [];
    for (const row of s.magnitudeDb) {
      const v = new Float64Array(nb);
      for (let b = 0; b < nb; b++) {
        const b0 = Math.max(1, Math.floor(edges[b] / s.binHz)), b1 = Math.max(b0 + 1, Math.ceil(edges[b + 1] / s.binHz));
        let acc = 0, k = 0;
        for (let i = b0; i < Math.min(s.bins, b1); i++) { acc += Math.pow(10, row[i] / 10); k++; }
        v[b] = k ? 10 * Math.log10(acc / k + 1e-12) : -120;
      }
      if (prev) { let f = 0; for (let b = 0; b < nb; b++) { const d = v[b] - prev[b]; if (d > 0) f += d; } flux.push(f); }
      prev = v;
    }
    if (flux.length > 2) { const fm = flux.reduce((a, b) => a + b, 0) / flux.length; fluxCrest = fm > 0 ? Math.max(...flux) / fm : 0; }
  }

  return {
    onsetRate: +(onsets / duration).toFixed(3),
    envelopeAsymmetry: +envelopeAsymmetry.toFixed(3),
    reverseLikeFraction: +reverseLikeFraction.toFixed(3),
    periodicityStrength: +Math.max(0, Math.min(1, periodicityStrength)).toFixed(3),
    periodicityLagSec: +periodicityLagSec.toFixed(3),
    repeatFraction: +repeatFraction.toFixed(3),
    repeatLagSec: +repeatLagSec.toFixed(4),
    fluxCrest: +fluxCrest.toFixed(2),
  };
};

/** Paso bajo Butterworth de 2.º orden (dos pasadas) usado antes de decimar. */
const filterVariableSimple = (x: Float32Array, fs: number, fc: number): Float32Array => {
  const w0 = (2 * Math.PI * Math.min(fc, fs * 0.49)) / fs, cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * 0.7071);
  const a0 = 1 + alpha;
  const bq = new Biquad((1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0, (-2 * cw) / a0, (1 - alpha) / a0);
  return bq.process(bq.process(x));
};
