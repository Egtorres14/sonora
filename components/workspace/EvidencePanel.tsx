import { MapPin } from 'lucide-react';
import { fmtRange, SOURCE_LABEL, type EvidenceItem } from '../../services/evidence';

interface Props { items: EvidenceItem[]; onSeek: (time: number) => void; canSeek: boolean; teacher: boolean }

export default function EvidencePanel({ items, onSeek, canSeek, teacher }: Props) {
  const timed = items.filter((i) => i.time !== undefined);
  const global = items.filter((i) => i.time === undefined);
  const Row = ({ item }: { item: EvidenceItem }) => {
    const seekable = canSeek && item.time !== undefined;
    const inner = <>
      <span className={`evidence-time ${item.source}`}>{item.time !== undefined ? fmtRange({ start: item.time, end: item.end }) : 'todo'}</span>
      <span className="evidence-body"><b>{item.criterio}</b><small>{SOURCE_LABEL[item.source]}{item.confidence !== undefined ? ` · confianza ${Math.round(item.confidence * 100)} %` : ''}{item.detalle ? ` · ${item.detalle}` : ''}</small></span>
      <span className={`evidence-points ${item.puntos === null ? 'none' : item.puntos < 0 ? 'neg' : 'pos'}`}>{item.puntos === null ? (item.source === 'modelo' ? 'sugerencia' : 'pista') : `${item.puntos > 0 ? '+' : ''}${item.puntos.toLocaleString('es')}`}</span>
    </>;
    return seekable
      ? <button type="button" className={`evidence-row ${item.source}`} onClick={() => onSeek(Math.max(0, item.time! - 0.5))} title="Escuchar desde aquí">{inner}</button>
      : <div className={`evidence-row ${item.source}`}>{inner}</div>;
  };
  return <section className="panel evidence-panel">
    <div className="panel-heading"><div><span className="eyebrow">DÓNDE OCURRE CADA COSA</span><h3>Cada punto tiene su momento.</h3></div><MapPin size={20} /></div>
    <div className="evidence-legend"><span><i className="medido" />Medido en el archivo</span><span><i className="profesor" />Anotado por el profesor</span><span><i className="modelo" />Sugerido por un modelo</span></div>
    {items.length === 0 && <p className="muted text-small">{teacher ? 'Aún no hay evidencias: las mediciones aparecen aquí y tus anotaciones con tiempos («0:12–0:18») se añaden al confirmar cada herramienta.' : 'El profesor todavía no ha anotado evidencias.'}</p>}
    {timed.length > 0 && <div className="evidence-list">{timed.map((item) => <Row key={item.id} item={item} />)}</div>}
    {global.length > 0 && <><p className="evidence-subhead">Sobre todo el archivo</p><div className="evidence-list">{global.map((item) => <Row key={item.id} item={item} />)}</div></>}
    {canSeek && timed.length > 0 && <p className="muted text-small">Pulsa una fila para escuchar desde ese momento; las mismas marcas están sobre la forma de onda.</p>}
  </section>;
}
