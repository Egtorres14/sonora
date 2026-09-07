import type { AudioFeatures } from '../../types';
export const displayNumber = (n: number, decimals = 1) => Number.isFinite(n) ? n.toFixed(decimals) : '−∞';
export default function Metrics({ features: f }: { features: AudioFeatures }) {
  const items = [
    { label: 'Sonoridad integrada', value: displayNumber(f.levels.integratedLufs), unit: 'LUFS', level: (f.levels.integratedLufs + 40) / 40, detail: 'Medida sobre el archivo', warn: false },
    { label: 'Pico verdadero', value: displayNumber(f.levels.truePeakDbtp), unit: 'dBTP', level: (f.levels.truePeakDbtp + 40) / 40, detail: f.clipping.interSampleOvers ? 'Revisar margen de pico' : 'Margen de pico disponible', warn: f.clipping.interSampleOvers },
    { label: 'Rango de sonoridad', value: displayNumber(f.levels.loudnessRangeLu), unit: 'LU', level: f.levels.loudnessRangeLu / 20, detail: 'Variación de la sonoridad', warn: false },
    { label: 'Clipping', value: String(f.clipping.runCount), unit: 'rachas', level: f.clipping.detected ? 0.95 : 0, detail: f.clipping.detected ? 'Saturación detectada' : 'Sin saturación detectada', warn: f.clipping.detected },
    { label: 'Clics y cortes', value: String(f.clicks.count + f.clicks.discontinuities), unit: 'eventos', level: (f.clicks.count + f.clicks.discontinuities) / 10, detail: 'Detecciones para escuchar', warn: f.clicks.count + f.clicks.discontinuities > 0 },
  ];
  return <div className="metric-grid">{items.map(m => <div className={`metric ${m.warn ? 'metric-warn' : ''}`} key={m.label}><span className="metric-label">{m.label}</span><div className="metric-value">{m.value}<small>{m.unit}</small></div><div className="meter-track"><i style={{ width: `${Math.max(0, Math.min(1, m.level)) * 100}%` }} /></div><span className="metric-detail">{m.detail}</span></div>)}</div>;
}
