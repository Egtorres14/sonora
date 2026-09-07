import { useRef, useState } from 'react';
import { ArrowUpRight, AudioLines, Upload } from 'lucide-react';
import { DEMOS, type DemoId } from '../../services/audio/demos';

interface Props { busy: boolean; onFiles: (files: File[]) => void; onDemo: (id: DemoId) => void; compact?: boolean; student?: string }
export default function UploadArea({ busy, onFiles, onDemo, compact = false, student }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <div className={compact ? 'upload-compact' : 'entry-layout'}>
    <div className="entry-main">
      {!compact && (student ? <div className="entry-title"><span className="eyebrow"><span className="status-dot" /> ENTREGA DE {student.toUpperCase()}</span><h2>Sube tu<br /><em>proyecto.</em></h2><p>Tu archivo se analiza en este navegador y queda registrado a tu nombre.<br className="desktop-only" /> Escribe después la sinopsis de tu pieza para el profesor.</p></div> : <div className="entry-title"><span className="eyebrow"><span className="status-dot" /> TU LABORATORIO, EN LOCAL</span><h2>Escucha.<br />Mide. <em>Comprueba.</em></h2><p>Una buena evaluación empieza por la evidencia.<br className="desktop-only" /> Analiza tus audios y construye tu propio criterio.</p></div>)}
      <div className={`drop-zone ${dragging ? 'is-dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) onFiles(Array.from(e.dataTransfer.files)); }}>
        <div className="upload-icon"><Upload size={23} strokeWidth={1.5} /></div>
        <h3>{compact ? (student ? 'Entrega otro archivo' : 'Añade más muestras') : student ? 'Selecciona tu archivo de audio' : 'Dale play a tu próximo análisis'}</h3>
        <p>Arrastra uno o varios archivos de audio aquí</p>
        <button className="button primary" disabled={busy} onClick={() => input.current?.click()}>Seleccionar archivos <ArrowUpRight size={17} /></button>
        <span className="upload-meta">WAV · AIFF · FLAC <span>Hasta 200 MB por archivo</span></span>
        <input ref={input} id="audio-upload" type="file" aria-label="Subir archivos de audio" className="visually-hidden" accept=".wav,.wave,.aif,.aiff,.aifc,.flac" multiple disabled={busy} onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </div>
    </div>
    {!compact && <aside className="entry-aside">
      <div className="visual-console" aria-label="Ilustración de una consola de audio">
        <div className="console-top"><span>SONORA / SIGNAL VIEW</span><span className="tiny-light" /></div>
        <div className="scope-grid"><svg viewBox="0 0 420 180" aria-hidden="true"><path className="scope-line" d={Array.from({ length: 210 }, (_, i) => `${i ? 'L' : 'M'}${i * 2},${90 + Math.sin(i * 0.27) * (Math.sin(i * 0.062) ** 8 * 66 + 3)}`).join(' ')} /><line x1="258" y1="12" x2="258" y2="168" className="scope-cursor" /></svg><span>FORMA DE ONDA</span></div>
        <div className="console-meters">{['L', 'R'].map((channel, c) => <div key={channel}><b>{channel}</b>{Array.from({ length: 28 }, (_, i) => <i key={i} className={i < 19 - c * 3 ? 'lit' : ''} />)}</div>)}</div>
        <div className="console-foot"><span>48 kHz / 24 bit</span><span>ILUSTRACIÓN</span></div>
      </div>
      <div className="entry-promise"><AudioLines size={22} /><div><h3>La evidencia va primero.</h3><p>Mediciones en tu equipo. Decisiones del profesor. Modelos que aportan una segunda opinión.</p></div></div>
      <div className="small-stat-row"><span><b>01</b> Analiza</span><span><b>02</b> Etiqueta</span><span><b>03</b> Aprende</span></div>
    </aside>}
    {!compact && !student && <section className="demo-section"><div className="section-heading"><div><span className="eyebrow">EMPIEZA A EXPLORAR</span><h3>Un oído para cada detalle.</h3></div><span className="muted text-small">Ejemplos sintéticos · excluidos del entrenamiento</span></div><div className="demo-grid">{DEMOS.map((demo, i) => <button key={demo.id} className="demo-card" disabled={busy} onClick={() => onDemo(demo.id)}><div className="demo-card-top"><span className="demo-number">0{i + 1}</span><ArrowUpRight size={18} /></div><div className={`mini-wave wave-${i}`} aria-hidden="true">{Array.from({ length: 36 }, (_, j) => <i key={j} style={{ height: `${12 + Math.abs(Math.sin(j * 1.7 + i) * Math.cos(j * 0.2)) * 36}px` }} />)}</div><h4>{demo.title}</h4><p>{demo.description}</p><div className="demo-card-bottom"><span>{demo.issue}</span><span>{demo.duration}</span></div></button>)}</div></section>}
  </div>;
}
