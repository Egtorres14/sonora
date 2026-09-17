import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { ArrowLeft, ClipboardCheck, Download, FileAudio, Play, Printer, Send, Upload, UserRound } from 'lucide-react';
import type { AnalyzedAudio } from '../../services/audio';
import { renderSpectrogramPng } from '../../services/audio/spectrogram';
import { EFFECTS, calculateReview, gradeDrift, publishGrade, withdrawGrade, type ReviewRecord } from '../../services/review';
import { downloadFile, jsonSafe } from '../../services/library';
import { isCurrentFeatures } from '../../services/audio/version';
import { buildEvidence, fmtRange, SOURCE_COLOR } from '../../services/evidence';
import type { LocalModel } from '../../services/learning/types';
import type { RubricConfig } from '../../services/scoring/rubric';
import type { EngineSettings } from '../../services/engines';
import AudioPlayer, { type Marker } from '../AudioPlayer';
import Metrics from './Metrics';
import ReviewPanel from './ReviewPanel';
import EvidencePanel from './EvidencePanel';
import MarkEditor from './MarkEditor';
import { EFFECT_COLOR, addMark, createMark, removeMark, updateMark, type AudioMark, type MarkPatch } from '../../services/marks';
import type { ToolId } from '../../services/scoring/rubric';
const ModelAdvice = lazy(() => import('./ModelAdvice'));

interface Props { record: ReviewRecord; analyzed: AnalyzedAudio | null; audioUrl: string; records: ReviewRecord[]; model: LocalModel | null; rubric: RubricConfig; engines: EngineSettings; teacher: boolean; onChange: (patch: Partial<ReviewRecord>) => void; onBack: () => void; onNewUpload: () => void; onEngines?: () => void; referenceUrl: string; onReference: (id: string) => void; referenceId: string }
const fmtDate = (iso: string) => new Date(iso).toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' });

export default function AnalysisView({ record, analyzed, audioUrl, records, model, rubric, engines, teacher, onChange, onBack, onNewUpload, onEngines, referenceUrl, onReference, referenceId }: Props) {
  const [spectrum, setSpectrum] = useState('');
  const [tab, setTab] = useState<'wave' | 'spectrum'>('wave');
  const [advice, setAdvice] = useState(false);
  const [tool, setTool] = useState<ToolId>('reversa');
  const [marking, setMarking] = useState(false);
  const [markNotice, setMarkNotice] = useState('');
  const seekRef = useRef<((time: number) => void) | null>(null);
  const [playTime, setPlayTime] = useState(0);
  const reviewRef = useRef<HTMLDivElement>(null);
  const signalRef = useRef<HTMLElement>(null);
  useEffect(() => { setSpectrum(''); setTab('wave'); setAdvice(false); setPlayTime(0); setMarking(false); setMarkNotice(''); }, [record.id]);
  useEffect(() => { if (tab !== 'spectrum' || !analyzed || spectrum) return; const frame = requestAnimationFrame(() => { const image = renderSpectrogramPng(analyzed.channels, analyzed.sampleRate, { width: 1100, height: 340, fftSize: 2048 }); setSpectrum(`data:image/png;base64,${image.base64}`); }); return () => cancelAnimationFrame(frame); }, [tab, analyzed, spectrum]);
  const reference = records.find(r => r.id === referenceId);
  const score = calculateReview(record, rubric);
  // El estudiante ve la nota tal como se publicó; un registro publicado antes de la instantánea cae al cálculo vivo.
  const snapshot = record.publishedGrade;
  const shown = snapshot
    ? { final: snapshot.final as number | null, maxTotal: snapshot.maxTotal, formal: snapshot.formal, formalMax: snapshot.formalMax, technical: snapshot.technical, technicalMax: snapshot.technicalMax, creative: snapshot.creative, creativeMax: snapshot.creativeMax, bonus: snapshot.bonus }
    : { final: score.final, maxTotal: score.maxTotal, formal: score.formal.total, formalMax: score.formalMax, technical: score.technical.total, technicalMax: score.technicalMax, creative: score.creative.total, creativeMax: score.creative.max, bonus: score.bonus };
  const graded = teacher ? score.final !== null : !!record.published && shown.final !== null;
  const drift = teacher ? gradeDrift(record, rubric) : null;
  const fmtGrade = (n: number | null) => n === null ? 'pendiente' : n.toLocaleString('es', { maximumFractionDigits: 2 });
  // Cada rol ve lo suyo: las decisiones del profesor solo llegan al estudiante al publicar la revisión.
  const evidence = useMemo(() => buildEvidence(record, rubric, teacher ? 'teacher' : 'student'), [record, rubric, teacher]);
  const duration = record.features.format.duration;
  // Las marcas se pintan desde el registro, no desde la lista de evidencias: si no, saldrían dos veces.
  const visibleMarks = teacher || record.published ? record.marks ?? [] : [];
  const extraMarkers = useMemo<Marker[]>(() => [
    ...evidence.filter(e => e.time !== undefined && e.source !== 'medido' && !e.id.startsWith('mark-')).map(e => ({ start: e.time!, end: e.end ?? Math.min(duration, e.time! + 0.25), color: SOURCE_COLOR[e.source], label: `${e.criterio} · ${e.source === 'profesor' ? 'profesor' : 'modelo'} · ${fmtRange({ start: e.time!, end: e.end })}` })),
    ...visibleMarks.map(m => ({ id: m.id, start: m.start, end: m.end, color: EFFECT_COLOR[m.effect], editable: teacher, label: `${EFFECTS.find(x => x.id === m.effect)?.label ?? m.effect} · profesor · ${fmtRange({ start: m.start, end: m.end })}` })),
  ], [evidence, duration, visibleMarks, teacher]);
  const applyMark = (result: MarkPatch) => {
    if (!Object.keys(result.patch).length) return;
    onChange(result.patch);
    setMarkNotice(result.proposedLabel ? `${EFFECTS.find(e => e.id === result.proposedLabel)?.label} pasa a «presente». Puedes cambiarlo en la revisión.` : '');
  };
  const addMarkHere = (mark: AudioMark) => { try { applyMark(addMark(record, mark)); } catch (e) { setMarkNotice(e instanceof Error ? e.message : 'No se pudo añadir la marca.'); } };
  const studentReading = !teacher && engines.studentAccess && engines.engine !== 'local';
  const seek = (t: number) => seekRef.current?.(t);

  return <div className="analysis-view">
    <div className="file-heading"><div><div className="back-row"><button className="text-button back-button" onClick={onBack}><ArrowLeft size={14} /> {teacher ? 'Biblioteca' : 'Mis entregas'}</button><button className="text-button back-button" onClick={onNewUpload}><Upload size={14} /> {teacher ? 'Subir otro archivo' : 'Entregar otro archivo'}</button></div><h2><FileAudio size={25} />{record.name}</h2><p>{record.origin === 'synthetic' ? 'DEMO SINTÉTICA' : record.student ? 'ENTREGA DE ESTUDIANTE' : 'MUESTRA REAL'} <span>·</span> {record.features.format.sampleRate.toLocaleString('es')} Hz <span>·</span> {record.features.format.bitDepth || '?'} bit <span>·</span> {record.features.format.channels} canales <span>·</span> {record.features.format.duration.toFixed(1)} s</p>{record.student && <p className="student-line"><UserRound size={13} /> {teacher ? `Entregado por ${record.student.name}` : 'Tu entrega'} <span>·</span> {fmtDate(record.student.submittedAt)}</p>}</div><div className="toolbar">{teacher && <button className="button secondary" onClick={() => downloadFile(JSON.stringify({ review: record, score, evidencias: evidence }, jsonSafe, 2), `${record.name}.informe.json`)}><Download size={15} /> Informe JSON</button>}{teacher && record.student && <button className={`button ${record.published ? 'secondary' : 'primary'}`} disabled={score.final === null && !record.published} title={score.final === null ? 'Completa la revisión para publicar la nota' : undefined} onClick={() => onChange(record.published ? withdrawGrade() : publishGrade(record, rubric))}><Send size={15} /> {record.published ? 'Retirar publicación' : 'Publicar al estudiante'}</button>}<button className="icon-button" aria-label="Imprimir o guardar informe como PDF" onClick={() => window.print()}><Printer size={18} /></button></div></div>
    {teacher && record.published && (drift || !snapshot) && <p className="notice grade-drift" role="status" data-testid="grade-drift">{drift
      ? <>Publicada <b>{fmtGrade(drift.published)}</b> · ahora calcularía <b>{fmtGrade(drift.live)}</b>. El estudiante sigue viendo la publicada.</>
      : <>Publicada sin instantánea: el estudiante ve el cálculo vivo. Vuelve a publicar para fijar la nota.</>}
      <button type="button" className="text-button" disabled={score.final === null} onClick={() => onChange(publishGrade(record, rubric))}><Send size={13} /> Volver a publicar</button></p>}
    <Metrics features={record.features} />
    <section className="panel signal-panel" ref={signalRef}><div className="panel-heading"><div><span className="eyebrow">EXPLORADOR DE SEÑAL</span><h3>Escucha dónde ocurre.</h3></div><div className="segmented" aria-label="Vista de audio"><button aria-pressed={tab === 'wave'} className={tab === 'wave' ? 'selected' : ''} onClick={() => setTab('wave')}>Forma de onda</button><button disabled={!analyzed} aria-pressed={tab === 'spectrum'} className={tab === 'spectrum' ? 'selected' : ''} onClick={() => setTab('spectrum')}>Espectrograma</button></div></div>
      {tab === 'spectrum' && <div className="spectrogram">{spectrum ? <img src={spectrum} alt="Espectrograma del audio: tiempo horizontal, frecuencia vertical y nivel representado por color." /> : <p>Generando espectrograma local…</p>}</div>}
      {audioUrl ? <AudioPlayer src={audioUrl} features={record.features} extraMarkers={extraMarkers} seekRef={seekRef} onTime={setPlayTime} zoomable={teacher} markEditing={marking ? { color: EFFECT_COLOR[tool] } : null} onMarkCreate={(start, end) => addMarkHere(createMark(tool, start, end, duration))} onMarkUpdate={(id, start, end) => applyMark(updateMark(record, id, { start, end }, duration))} /> : <div className="empty-audio">Este registro contiene métricas y etiquetas. Vuelve a subir el audio original para escucharlo; se reconocerá por su huella.</div>}
      {teacher && <>
        {markNotice && <p className="notice" role="status">{markNotice}</p>}
        <MarkEditor record={record} duration={duration} tool={tool} onTool={setTool} marking={marking} onMarking={setMarking} currentTime={playTime} canSeek={!!audioUrl} onSeek={seek}
          onAdd={addMarkHere}
          onUpdate={(id, changes) => applyMark(updateMark(record, id, changes, duration))}
          onRemove={id => applyMark(removeMark(record, id))} />
      </>}
      {record.features.analysis.warnings.length > 0 && <details className="measurement-warnings"><summary>Notas sobre estas mediciones ({record.features.analysis.warnings.length})</summary>{record.features.analysis.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
      {!isCurrentFeatures(record.features) && !audioUrl && <p className="notice" data-testid="outdated-record">Esta muestra se midió con una versión anterior ({record.features.version}). Su nota sigue siendo válida, pero no entra en el entrenamiento. Vuelve a subir el archivo original: se reconocerá por su huella y se medirá de nuevo.</p>}
    </section>

    {teacher && <button type="button" className="button primary mobile-cta" onClick={() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><ClipboardCheck size={16} /> Revisar y calificar</button>}
    <EvidencePanel items={evidence} duration={record.features.format.duration} currentTime={playTime} onSeek={seek} canSeek={!!audioUrl} teacher={teacher} />

    {teacher ? <>
      <section className="panel context-panel"><div className="panel-heading"><div><span className="eyebrow">CONTEXTO Y PROCEDENCIA</span><h3>Cada muestra tiene una historia.</h3></div><span className="pill">Etiquetado humano</span></div><div className="two-fields"><label className="field">Sinopsis del estudiante<textarea rows={2} value={record.synopsis} placeholder="Intención y concepto de la pieza…" onChange={e => onChange({ synopsis: e.target.value })} /></label><label className="field">Objetivo del ejercicio<textarea rows={2} value={record.context} placeholder="Herramientas y objetivos que vas a evaluar…" onChange={e => onChange({ context: e.target.value })} /></label></div><div className="two-fields"><label className="field">Grupo de grabación de origen<input value={record.sourceGroup} placeholder="Ej.: campana-estudio-01" maxLength={200} onChange={e => onChange({ sourceGroup: e.target.value })} /><small>Usa el mismo grupo para el original y todas sus versiones procesadas.</small></label><label className="field">Comparar con una fuente de la biblioteca<select value={referenceId} onChange={e => onReference(e.target.value)}><option value="">Seleccionar original…</option>{records.filter(r => r.id !== record.id).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select><small>La comparación ayuda a verificar procesos que no se pueden deducir de una mezcla final.</small></label></div>{reference && <div className="reference-player"><div><b>Fuente: {reference.name}</b><p>Duración relativa: {(record.features.format.duration / reference.features.format.duration).toFixed(2)}× · diferencia de centroide: {Math.round(record.features.spectrum.centroidHz - reference.features.spectrum.centroidHz)} Hz. Son diferencias medidas, no pruebas de un efecto.</p></div>{referenceUrl ? <audio controls src={referenceUrl} aria-label="Reproducir fuente de referencia" /> : <p className="muted">Audio de referencia no disponible localmente.</p>}</div>}</section>
      <div ref={reviewRef}><ReviewPanel record={record} rubric={rubric} onChange={onChange} engines={engines} /></div>
      <section className="panel advice-panel"><div className="panel-heading"><div><span className="eyebrow">UNA SEGUNDA OPINIÓN</span><h3>La ayuda es opcional. El criterio, tuyo.</h3></div><button className="button secondary" aria-expanded={advice} onClick={() => setAdvice(!advice)}>{advice ? 'Ocultar asistentes' : 'Ver asistentes'}</button></div><p className="muted text-small">Consulta tu modelo local o el proveedor elegido en «Motores de IA». Sus sugerencias se muestran aparte, con su momento en la lista de evidencias, y no cambian la nota ni las etiquetas.</p>{advice && <Suspense fallback={<p>Cargando asistentes…</p>}><ModelAdvice record={record} analyzed={analyzed} model={model} engines={engines} teacher onChange={onChange} onEngines={onEngines} /></Suspense>}</section>
    </> : <>
      <section className="panel context-panel"><div className="panel-heading"><div><span className="eyebrow">TU SINOPSIS</span><h3>Cuéntale al profesor qué has hecho.</h3></div></div><label className="field">Sinopsis de la pieza<textarea rows={3} value={record.synopsis} placeholder="Intención, concepto y qué procesos aplicaste (y dónde)…" onChange={e => onChange({ synopsis: e.target.value })} /><small>Indicar dónde usaste cada herramienta (por ejemplo, «0:12–0:19 reversa») ayuda a que la revisión sea justa.</small></label>{record.context && <div className="field"><span>Objetivo del ejercicio</span><p className="context-text">{record.context}</p></div>}</section>
      {studentReading && <section className="panel advice-panel"><div className="panel-heading"><div><span className="eyebrow">LECTURA ORIENTATIVA</span><h3>Qué oye un modelo en tu pieza.</h3></div></div><p className="muted text-small">Tu profesor ha activado una lectura automática: describe lo que un modelo cree oír, con sus límites. No es una nota.</p><Suspense fallback={<p>Cargando…</p>}><ModelAdvice record={record} analyzed={analyzed} model={null} engines={engines} teacher={false} onChange={onChange} /></Suspense></section>}
      <section className={`panel student-status ${graded ? 'graded' : ''}`}><div className="panel-heading"><div><span className="eyebrow">ESTADO DE TU ENTREGA</span><h3>{graded ? 'Revisión terminada.' : 'Pendiente de revisión.'}</h3></div>{graded && <div className="score-display" data-testid="student-score"><strong>{shown.final!.toLocaleString('es', { maximumFractionDigits: 2 })}</strong><span>/ {shown.maxTotal}</span></div>}</div>
        {graded ? <><div className="score-breakdown">{[{ label: 'Formal', value: shown.formal, max: shown.formalMax }, { label: 'Técnica', value: shown.technical, max: shown.technicalMax }, { label: 'Creatividad', value: shown.creative, max: shown.creativeMax }].map(row => <div key={row.label}><span>{row.label}</span><b>{row.value}<small> / {row.max}</small></b><div><i style={{ width: `${row.max ? row.value / row.max * 100 : 0}%` }} /></div></div>)}{shown.bonus > 0 && <div className="bonus-row"><span>Extra</span><b>+{shown.bonus}</b></div>}</div>{record.notes ? <div className="field"><span>Comentarios del profesor</span><p className="context-text">{record.notes}</p></div> : <p className="muted text-small">El profesor no ha dejado comentarios.</p>}</>
          : <p className="muted text-small">Tu profesor aún no ha publicado la revisión. Mientras tanto puedes escuchar tu archivo, ver sus mediciones y completar la sinopsis.</p>}
      </section>
      <div className="student-actions"><button type="button" className="button secondary" onClick={() => window.print()}><Printer size={15} /> Informe PDF</button><button type="button" className="button primary" disabled={!audioUrl} onClick={() => { signalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); const first = evidence.find(e => e.time !== undefined); seek(first ? Math.max(0, first.time! - 0.5) : 0); }}><Play size={15} /> Escuchar con marcas</button></div>
    </>}
  </div>;
}
