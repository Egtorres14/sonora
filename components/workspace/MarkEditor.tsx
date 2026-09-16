import { MapPin, Play, Plus, Trash2 } from 'lucide-react';
import { EFFECTS, type ReviewRecord } from '../../services/review';
import { EFFECT_COLOR, MAX_NOTE, createMark, type AudioMark } from '../../services/marks';
import { formatTimestamp } from '../../services/audio/features';
import type { ToolId } from '../../services/scoring/rubric';

interface Props {
  record: ReviewRecord;
  duration: number;
  /** Herramienta en modo marcado, o null si está desactivado. */
  marking: ToolId | null;
  onMarking: (effect: ToolId | null) => void;
  /** Posición del cursor de reproducción, para «marcar desde aquí». */
  currentTime: number;
  canSeek: boolean;
  onSeek: (time: number) => void;
  onAdd: (mark: AudioMark) => void;
  onUpdate: (id: string, changes: Partial<Pick<AudioMark, 'start' | 'end' | 'note'>>) => void;
  onRemove: (id: string) => void;
}

const labelOf = (effect: ToolId) => EFFECTS.find(e => e.id === effect)?.label ?? effect;

/** Barra de marcado y lista editable. La lista funciona sin ratón y sin audio. */
export default function MarkEditor({ record, duration, marking, onMarking, currentTime, canSeek, onSeek, onAdd, onUpdate, onRemove }: Props) {
  const marks = record.marks ?? [];
  const active: ToolId = marking ?? 'reversa';
  const fromCursor = () => onAdd(createMark(active, currentTime, currentTime + 1, duration));

  return <div className="mark-editor">
    <div className="mark-toolbar">
      <MapPin size={16} />
      <label className="visually-hidden" htmlFor="mark-effect">Herramienta que vas a marcar</label>
      <select id="mark-effect" value={active} onChange={e => onMarking(marking ? e.target.value as ToolId : null)}>
        {EFFECTS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
      </select>
      <button type="button" className={`button ${marking ? 'primary' : 'secondary'}`} aria-pressed={!!marking} onClick={() => onMarking(marking ? null : active)}>
        {marking ? 'Marcando…' : 'Marcar'}
      </button>
      <button type="button" className="button secondary" onClick={fromCursor}><Plus size={14} /> Marcar desde el tiempo actual</button>
      <small className="muted text-small">{marking ? `Arrastra sobre la onda para marcar ${labelOf(active).toLowerCase()}.` : 'Activa «Marcar» y arrastra sobre la onda, o añade la marca desde el cursor y ajusta los tiempos abajo.'}</small>
    </div>

    {marks.length === 0
      ? <p className="muted text-small">Todavía no has marcado nada en este audio.</p>
      : <ul className="mark-list">{marks.map(m => <li key={m.id} className="mark-row">
          <span className="mark-swatch" style={{ background: EFFECT_COLOR[m.effect] }} aria-hidden="true" />
          <b className="mark-effect">{labelOf(m.effect)}</b>
          <label className="visually-hidden" htmlFor={`start-${m.id}`}>Inicio de la marca de {labelOf(m.effect)}</label>
          <input id={`start-${m.id}`} type="number" className="mark-time" min={0} max={duration} step={0.01} value={m.start} onChange={e => onUpdate(m.id, { start: Number(e.target.value) })} />
          <label className="visually-hidden" htmlFor={`end-${m.id}`}>Final de la marca de {labelOf(m.effect)}</label>
          <input id={`end-${m.id}`} type="number" className="mark-time" min={0} max={duration} step={0.01} value={m.end} onChange={e => onUpdate(m.id, { end: Number(e.target.value) })} />
          <span className="mark-range mono">{formatTimestamp(m.start)}–{formatTimestamp(m.end)}</span>
          <input className="mark-note" maxLength={MAX_NOTE} placeholder="Qué se oye aquí…" aria-label={`Comentario de la marca de ${labelOf(m.effect)}`} value={m.note} onChange={e => onUpdate(m.id, { note: e.target.value })} />
          {canSeek && <button type="button" className="icon-button" aria-label={`Escuchar la marca de ${labelOf(m.effect)}`} onClick={() => onSeek(Math.max(0, m.start - 0.3))}><Play size={14} /></button>}
          <button type="button" className="icon-button" aria-label={`Borrar la marca de ${labelOf(m.effect)}`} onClick={() => onRemove(m.id)}><Trash2 size={14} /></button>
        </li>)}</ul>}
  </div>;
}
