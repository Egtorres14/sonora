import { fmtRange, type EvidenceItem, type EvidenceSource } from '../../services/evidence';
import { formatTimestamp } from '../../services/audio/features';

interface Props { items: EvidenceItem[]; duration: number; currentTime: number; onSeek: (time: number) => void; canSeek: boolean }
const LANES: { source: EvidenceSource; label: string }[] = [{ source: 'medido', label: 'MEDIDO' }, { source: 'profesor', label: 'PROFESOR' }, { source: 'modelo', label: 'MODELO' }];

/** Línea de evidencias: tres carriles (medido / profesor / modelo) con las marcas en su momento y el cursor de reproducción. */
export default function EvidenceTimeline({ items, duration, currentTime, onSeek, canSeek }: Props) {
  const timed = items.filter((i) => i.time !== undefined);
  if (!timed.length || !duration) return null;
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / duration) * 100))}%`;
  const step = duration > 180 ? 30 : duration > 90 ? 15 : duration > 40 ? 10 : 5;
  const ticks: number[] = []; for (let t = 0; t <= duration; t += step) ticks.push(t);
  return <div className="evidence-timeline" role="group" aria-label="Línea de evidencias">
    {LANES.map((lane) => {
      const marks = timed.filter((i) => i.source === lane.source);
      return <div className={`tl-lane ${lane.source}`} key={lane.source}>
        <span className="tl-label">{lane.label}</span>
        <div className="tl-track">
          {marks.map((m) => {
            const range = m.end !== undefined && m.end > m.time!;
            const title = `${m.criterio} · ${fmtRange({ start: m.time!, end: m.end })}${m.confidence !== undefined ? ` · ${Math.round(m.confidence * 100)} %` : ''}`;
            const style = range ? { left: pct(m.time!), width: `calc(${pct(m.end! - m.time!)} + 2px)` } : { left: pct(m.time!) };
            const inner = <><span className="tl-text">{formatTimestamp(m.time!).replace(/\.\d+$/, '')} {m.criterio.replace(/ (confirmado|ausente|sugerido)$/, '')}</span></>;
            return canSeek
              ? <button type="button" key={m.id} className={range ? 'tl-range' : 'tl-dot'} style={style} title={title} aria-label={title} onClick={() => onSeek(Math.max(0, m.time! - 0.5))}>{inner}</button>
              : <span key={m.id} className={range ? 'tl-range' : 'tl-dot'} style={style} title={title}>{inner}</span>;
          })}
        </div>
      </div>;
    })}
    <div className="tl-axis">{ticks.map((t) => <span key={t} style={{ left: pct(t) }}>{formatTimestamp(t).replace(/\.\d+$/, '')}</span>)}</div>
    {currentTime > 0 && <i className="tl-playhead" style={{ left: pct(currentTime) }} aria-hidden="true" />}
  </div>;
}
