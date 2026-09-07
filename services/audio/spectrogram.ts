/**
 * Renderizado de espectrograma (eje de frecuencia logarítmico) y forma de onda a PNG
 * para modelos de visión. Solo navegador (usa <canvas>).
 */
import { stft, downmixMono, dB } from './dsp';
import type { ModelImage } from '../llm/types';

// Paleta tipo "magma": negro → púrpura → naranja → amarillo claro
const STOPS: [number, [number, number, number]][] = [
  [0.0, [0, 0, 4]], [0.15, [40, 12, 70]], [0.3, [100, 20, 110]], [0.45, [160, 40, 100]],
  [0.6, [215, 70, 70]], [0.75, [245, 125, 45]], [0.9, [252, 190, 70]], [1.0, [252, 250, 190]],
];
const colorAt = (v: number): [number, number, number] => {
  const t = Math.max(0, Math.min(1, v));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
      const u = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
    }
  }
  return STOPS[STOPS.length - 1][1];
};

const formatHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 ? 1 : 0)}k` : `${hz}`);
const formatSec = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

export interface SpectrogramOptions { width?: number; height?: number; fftSize?: number; rangeDb?: number; fMin?: number }

export const renderSpectrogramPng = (channels: Float32Array[], fs: number, opts: SpectrogramOptions = {}): ModelImage => {
  const { width = 1400, height = 560, fftSize = 4096, rangeDb = 90, fMin = 20 } = opts;
  const mono = downmixMono(channels);
  const duration = mono.length / fs;
  const marginL = 64, marginR = 16, marginT = 36, marginB = 40;
  const plotW = width - marginL - marginR, plotH = height - marginT - marginB;
  const hop = Math.max(256, Math.floor(mono.length / plotW / 2) || 256);
  const s = stft(mono, fs, fftSize, hop);
  const fMax = fs / 2;

  // Máximo global para escalar (evita que un archivo silencioso salga negro)
  let top = -Infinity;
  for (const row of s.magnitudeDb) for (let b = 1; b < row.length; b++) if (row[b] > top) top = row[b];
  if (!Number.isFinite(top)) top = 0;
  top = Math.min(0, top);
  const bottom = top - rangeDb;

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);

  const img = ctx.createImageData(plotW, plotH);
  const framesPerCol = s.frames / plotW;
  // Para cada fila (frecuencia log) precalculamos el rango de bins
  const rowBins: [number, number][] = [];
  for (let r = 0; r < plotH; r++) {
    const fHi = fMax * Math.pow(fMin / fMax, r / plotH);
    const fLo = fMax * Math.pow(fMin / fMax, (r + 1) / plotH);
    const b0 = Math.max(1, Math.floor(fLo / s.binHz)), b1 = Math.max(b0, Math.min(s.bins - 1, Math.ceil(fHi / s.binHz)));
    rowBins.push([b0, b1]);
  }
  for (let c = 0; c < plotW; c++) {
    const f0 = Math.floor(c * framesPerCol), f1 = Math.max(f0 + 1, Math.floor((c + 1) * framesPerCol));
    for (let r = 0; r < plotH; r++) {
      const [b0, b1] = rowBins[r];
      let v = -Infinity;
      for (let f = f0; f < Math.min(f1, s.frames); f++) { const row = s.magnitudeDb[f]; for (let b = b0; b <= b1; b++) if (row[b] > v) v = row[b]; }
      const t = (v - bottom) / (top - bottom);
      const [R, G, B] = colorAt(t);
      const p = (r * plotW + c) * 4;
      img.data[p] = R; img.data[p + 1] = G; img.data[p + 2] = B; img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, marginL, marginT);

  // Ejes
  ctx.fillStyle = '#ddd'; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
  ctx.font = '13px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    if (hz < fMin || hz > fMax) continue;
    const y = marginT + plotH * (Math.log(fMax / hz) / Math.log(fMax / fMin));
    ctx.fillText(formatHz(hz), marginL - 6, y);
    ctx.beginPath(); ctx.moveTo(marginL, y); ctx.lineTo(marginL + plotW, y); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = duration > 180 ? 30 : duration > 90 ? 10 : 5;
  for (let t = 0; t <= duration; t += step) {
    const x = marginL + (t / duration) * plotW;
    ctx.fillText(formatSec(t), x, marginT + plotH + 6);
    ctx.beginPath(); ctx.moveTo(x, marginT); ctx.lineTo(x, marginT + plotH); ctx.stroke();
  }
  ctx.textAlign = 'left'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`Espectrograma · ${fs} Hz · eje Y log ${fMin} Hz–${formatHz(fMax)} · color = nivel (${bottom.toFixed(0)} a ${top.toFixed(0)} dB)`, marginL, 10);

  return {
    base64: canvas.toDataURL('image/png').split(',')[1],
    mimeType: 'image/png',
    width, height,
    description: `Eje X: tiempo 0 s–${duration.toFixed(1)} s (marcas cada ${step} s). Eje Y: frecuencia logarítmica ${fMin} Hz–${formatHz(fMax)} (líneas en 100 Hz, 1 kHz, 10 kHz). Color: nivel en dB, negro = ${bottom.toFixed(0)} dB o menos, amarillo claro = ${top.toFixed(0)} dB (máximo del archivo). FFT ${fftSize}, mezcla mono del original a ${fs} Hz.`,
  };
};

export const renderWaveformPng = (channels: Float32Array[], fs: number, opts: { width?: number; height?: number } = {}): ModelImage => {
  const { width = 1400, height = 220 } = opts;
  const marginL = 64, marginR = 16, marginT = 24, marginB = 28;
  const plotW = width - marginL - marginR, plotH = height - marginT - marginB;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b0b10'; ctx.fillRect(0, 0, width, height);
  const n = channels[0].length, duration = n / fs;
  const laneH = plotH / channels.length;
  channels.forEach((x, c) => {
    const mid = marginT + laneH * c + laneH / 2;
    ctx.fillStyle = c === 0 ? '#7c5cff' : '#3de8a6';
    for (let col = 0; col < plotW; col++) {
      const i0 = Math.floor((col / plotW) * n), i1 = Math.max(i0 + 1, Math.floor(((col + 1) / plotW) * n));
      let lo = 1, hi = -1;
      for (let i = i0; i < i1; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const y0 = mid - hi * (laneH / 2) * 0.95, y1 = mid - lo * (laneH / 2) * 0.95;
      ctx.fillRect(marginL + col, y0, 1, Math.max(1, y1 - y0));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(marginL, mid); ctx.lineTo(marginL + plotW, mid); ctx.stroke();
    ctx.fillStyle = '#ddd'; ctx.font = '12px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(channels.length === 1 ? 'mono' : c === 0 ? 'L' : c === 1 ? 'R' : `ch${c + 1}`, marginL - 6, mid);
  });
  ctx.fillStyle = '#ddd'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = duration > 180 ? 30 : duration > 90 ? 10 : 5;
  for (let t = 0; t <= duration; t += step) ctx.fillText(formatSec(t), marginL + (t / duration) * plotW, marginT + plotH + 6);
  ctx.textAlign = 'left'; ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`Forma de onda · ${channels.length} canal(es) · pico ${dB(Math.max(...channels.map((x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))).toFixed(1)} dBFS`, marginL, 4);
  return {
    base64: canvas.toDataURL('image/png').split(',')[1],
    mimeType: 'image/png', width, height,
    description: `Amplitud por canal a lo largo del tiempo (0–${duration.toFixed(1)} s, marcas cada ${step} s). Escala lineal, ±1 = fondo de escala.`,
  };
};
