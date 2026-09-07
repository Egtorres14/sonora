import React, { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import type { AudioFeatures } from '../types';
import { formatTimestamp } from '../services/audio/features';

const PlayIcon = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5V19L19 12L8 5Z" /></svg>);
const PauseIcon = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19H10V5H6V19ZM14 5V19H18V5H14Z" /></svg>);
const VolumeHighIcon = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9V15H7L12 20V4L7 9H3ZM18.5 12C18.5 10.23 17.54 8.71 16 7.97V16.02C17.54 15.29 18.5 13.77 18.5 12ZM14 3.23V5.29C16.89 6.15 19 8.83 19 12C19 15.17 16.89 17.84 14 18.7V20.77C18.01 19.86 21 16.28 21 12C21 7.72 18.01 4.14 14 3.23Z"/></svg>);

export interface Marker { start: number; end: number; color: string; label: string }

interface AudioPlayerProps {
  src: string;
  features: AudioFeatures | null;
  /** Marcas adicionales (anotaciones del profesor, sugerencias del modelo). */
  extraMarkers?: Marker[];
  /** Recibe una función para saltar a un instante y reproducir. */
  seekRef?: MutableRefObject<((time: number) => void) | null>;
}

const buildMarkers = (f: AudioFeatures | null): Marker[] => {
  if (!f) return [];
  const m: Marker[] = [];
  const dur = f.format.duration;
  for (const e of f.clicks.events.slice(0, 100)) {
    m.push({ start: e.time, end: Math.min(dur, e.time + 0.02), color: e.kind === 'click' ? 'rgba(248,113,113,0.85)' : 'rgba(251,146,60,0.85)', label: `${e.kind === 'click' ? 'Clic' : 'Corte'} ${formatTimestamp(e.time)} · conf. ${Math.round(e.confidence * 100)} %` });
  }
  for (const t of f.clipping.timestamps.slice(0, 50)) m.push({ start: t, end: Math.min(dur, t + 0.05), color: 'rgba(250,204,21,0.7)', label: `Clipping ${formatTimestamp(t)}` });
  for (const g of f.silence.gaps.slice(0, 20)) m.push({ start: g.start, end: g.end, color: 'rgba(148,163,184,0.35)', label: `Silencio ${formatTimestamp(g.start)}–${formatTimestamp(g.end)}` });
  for (const t of f.heuristics.reverseEnvelopeTimes.slice(0, 20)) m.push({ start: Math.max(0, t - 0.3), end: Math.min(dur, t + 0.05), color: 'rgba(61,232,166,0.25)', label: `¿Reversa? ${formatTimestamp(t)} (heurístico)` });
  return m;
};

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, features, extraMarkers = [], seekRef }) => {
  const extraKey = extraMarkers.map((m) => `${m.start.toFixed(2)}-${m.end.toFixed(2)}-${m.label}`).join('|');
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [hover, setHover] = useState<string>('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const formatTime = useCallback((t: number) => {
    if (isNaN(t) || t < 0) return '0:00';
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }, []);

  useEffect(() => {
    if (!waveformRef.current) return;
    setReady(false); setError(''); setIsPlaying(false); setCurrentTime(0); setDuration(0);
    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#718d55',
      progressColor: '#c7eb99',
      cursorColor: '#efefe6',
      barWidth: 3, barRadius: 3, barGap: 2, height: 128,
      url: src,
      plugins: [regions],
    });
    wavesurferRef.current = ws;
    regionsRef.current = regions;

    const onReady = () => {
      setReady(true);
      setDuration(ws.getDuration());
      ws.setVolume(volume);
      if (seekRef) seekRef.current = (time: number) => { ws.setTime(Math.max(0, Math.min(ws.getDuration(), time))); void ws.play().catch(() => setError('No se pudo iniciar la reproducción.')); };
    };
    ws.on('ready', onReady);
    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('timeupdate', (t: number) => setCurrentTime(t));
    ws.on('finish', () => setIsPlaying(false));
    ws.on('error', () => { setReady(false); setError('El navegador no pudo reproducir este formato. Las métricas del archivo siguen disponibles.'); });
    return () => { wavesurferRef.current = null; regionsRef.current = null; if (seekRef) seekRef.current = null; ws.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Las marcas se actualizan sin recargar el audio (cada tecla en una evidencia cambia las regiones, no el reproductor).
  useEffect(() => {
    const ws = wavesurferRef.current, regions = regionsRef.current;
    if (!ready || !ws || !regions) return;
    regions.clearRegions();
    for (const mk of [...buildMarkers(features), ...extraMarkers]) {
      const region = regions.addRegion({ start: mk.start, end: mk.end, color: mk.color, drag: false, resize: false, content: mk.end - mk.start > 0.5 ? mk.label.split(' · ')[0] : undefined });
      region.on('over', () => setHover(mk.label));
      region.on('leave', () => setHover(''));
      region.on('click', (e) => { e.stopPropagation(); ws.setTime(Math.max(0, mk.start - 0.5)); void ws.play().catch(() => setError('No se pudo iniciar la reproducción.')); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, features, extraKey]);

  const togglePlayPause = useCallback(() => { void wavesurferRef.current?.playPause().catch(() => setError('No se pudo iniciar la reproducción.')); }, []);
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value); setVolume(v); wavesurferRef.current?.setVolume(v);
  }, []);

  const markerCount = (features ? features.clicks.events.length + features.clipping.timestamps.length : 0) + extraMarkers.length;

  return (
    <div className="bg-brand-bg/50 p-4 rounded-lg flex flex-col space-y-3">
      <div ref={waveformRef} className="w-full h-32 cursor-pointer" />
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="flex items-center justify-between text-xs text-brand-text-secondary min-h-[1.25rem] gap-3 flex-wrap">
        <span className="flex gap-3 flex-wrap">
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'rgba(248,113,113,0.85)' }} />clic</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'rgba(251,146,60,0.85)' }} />corte</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'rgba(250,204,21,0.7)' }} />clipping</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'rgba(148,163,184,0.35)' }} />silencio</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'rgba(61,232,166,0.25)' }} />¿reversa?</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'rgba(239,239,230,0.35)' }} />profesor</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'rgba(199,235,153,0.55)' }} />modelo</span>
        </span>
        <span className="italic">{hover || (markerCount ? 'Pasa el ratón por un marcador; haz clic para escucharlo.' : 'Sin problemas marcados.')}</span>
      </div>
      <div className="flex items-center space-x-4">
        <button disabled={!ready} onClick={togglePlayPause} className="text-brand-secondary hover:text-white transition-colors duration-200 p-2 bg-brand-surface rounded-full" aria-label={isPlaying ? 'Pausar' : 'Reproducir'}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="text-sm font-mono text-brand-text-secondary w-14 text-center"><span>{formatTime(currentTime)}</span></div>
        <div className="flex items-center space-x-2 flex-grow">
          <VolumeHighIcon />
          <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVolumeChange} className="w-full h-1.5 bg-brand-border rounded-lg appearance-none cursor-pointer accent-brand-secondary" aria-label="Volumen" />
        </div>
        <div className="text-sm font-mono text-brand-text-secondary w-14 text-center"><span>{formatTime(duration)}</span></div>
      </div>
    </div>
  );
};

export default AudioPlayer;
