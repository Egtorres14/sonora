import { lazy, Suspense } from 'react';
import { Activity, ArrowUpRight, BookOpen, ChevronRight, CircleHelp, Database, FolderCheck, Layers3, LoaderCircle, LockKeyhole, LogOut, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import useWorkspace, { type WorkspaceView } from './components/workspace/useWorkspace';
import UploadArea from './components/workspace/UploadArea';
import AnalysisView from './components/workspace/AnalysisView';
import LibraryView from './components/workspace/LibraryView';
import RoleGate from './components/RoleGate';
const LearningView = lazy(() => import('./components/workspace/LearningView'));
const RubricEditor = lazy(() => import('./components/workspace/RubricEditor'));
const EnginesView = lazy(() => import('./components/workspace/EnginesView'));

/** Marca animada: cinco barras que respiran (se detiene con «reducir movimiento»). */
const BrandBars = () => <span className="brand-bars" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} style={{ animationDelay: `${i * 0.18}s` }} />)}</span>;

const TEACHER_NAV = [
  { id: 'lab', label: 'Laboratorio', icon: Activity, number: '01', eyebrow: 'ANÁLISIS & EVIDENCIA' },
  { id: 'library', label: 'Biblioteca', icon: Database, number: '02', eyebrow: 'MUESTRAS & ANOTACIONES' },
  { id: 'rubric', label: 'Rúbrica', icon: SlidersHorizontal, number: '03', eyebrow: 'CRITERIOS & PUNTOS' },
  { id: 'engines', label: 'Motores de IA', icon: Sparkles, number: '04', eyebrow: 'SEGUNDA OPINIÓN & COSTES' },
  { id: 'learning', label: 'Modelo local', icon: Layers3, number: '05', eyebrow: 'DATOS & VALIDACIÓN' },
] as const;
const STUDENT_NAV = [
  { id: 'lab', label: 'Entregar', icon: Activity, number: '01', eyebrow: 'TU PROYECTO' },
  { id: 'library', label: 'Mis entregas', icon: FolderCheck, number: '02', eyebrow: 'ENTREGAS & CALIFICACIÓN' },
] as const;

export default function App() {
  const w = useWorkspace();
  if (!w.session) return <RoleGate onEnter={w.enter} />;
  const teacher = w.isTeacher;
  const nav = teacher ? TEACHER_NAV : STUDENT_NAV;
  const current = nav.find(n => n.id === w.view) ?? nav[0];
  const studentName = w.session.studentName ?? '';
  const modelStale = w.model && (w.model.trainingSampleIds.some(id => !w.allRecords.some(r => r.id === id)) || w.allRecords.some(r => w.model!.trainingSampleIds.includes(r.id) && r.updatedAt > w.model!.trainedAt));
  return <div className="app-shell"><a className="skip-link" href="#main-content">Saltar al contenido</a><aside className="sidebar"><a href="#" className="brand" onClick={e => { e.preventDefault(); w.setView('lab'); }} aria-label="Sonora, laboratorio de audio"><BrandBars /><span>sonora<span className="brand-dot">.</span><small>LABORATORIO DE AUDIO</small></span></a><div className="sidebar-section-label">{teacher ? 'ESPACIO DEL PROFESOR' : 'ESPACIO DEL ESTUDIANTE'}</div><nav aria-label="Navegación principal">{nav.map(item => <button key={item.id} aria-current={w.view === item.id ? 'page' : undefined} className={w.view === item.id ? 'active' : ''} onClick={() => w.setView(item.id as WorkspaceView)}><item.icon size={19} strokeWidth={1.5} /><span>{item.label}</span>{item.id === 'library' && w.records.length ? <b>{w.records.length}</b> : <small>{item.number}</small>}</button>)}</nav>
    {teacher ? <div className="sidebar-lesson"><div className="lesson-icon"><BookOpen size={19} /></div><span className="eyebrow">APRENDER A ESCUCHAR</span><h3>Mejores datos.<br />Mejores decisiones.</h3><p>Construye una colección con ejemplos verificados por ti.</p><button className="text-button" onClick={() => w.setView('learning')}>Cómo empezar <ArrowUpRight size={15} /></button></div>
      : <div className="sidebar-lesson"><div className="lesson-icon"><FolderCheck size={19} /></div><span className="eyebrow">TU ENTREGA</span><h3>Sube, describe,<br />entrega.</h3><p>Tu profesor verá tu nombre, tu sinopsis y las mediciones del archivo.</p><button className="text-button" onClick={() => w.setView('library')}>Ver mis entregas <ArrowUpRight size={15} /></button></div>}
    <div className="sidebar-bottom"><span className="status-dot" /><div><b>Tu audio se queda aquí</b><small>Procesamiento y almacenamiento local</small></div><LockKeyhole size={16} /></div></aside>
    <div className="workspace-shell"><header className="workspace-header"><div className="breadcrumb"><span>{teacher ? 'Profesor' : 'Estudiante'}</span><ChevronRight size={13} /><b>{current.label}</b></div><div className="header-right"><span className="local-badge"><span className="status-dot" />{teacher ? 'Motor local activo' : studentName}</span><span className="header-divider" /><span className="profile-avatar" title={teacher ? 'Profesor' : studentName}>{teacher ? 'P' : studentName.trim().charAt(0).toUpperCase() || 'E'}</span><button className="text-button" onClick={w.leave} aria-label="Salir y volver al menú de entrada"><LogOut size={14} /> Salir</button></div></header><main id="main-content" className="workspace-content">
      <div className="workspace-topline"><span className="eyebrow">{current.eyebrow}</span><span className="text-small muted">{w.saving ? 'Guardando cambios…' : 'Espacio local'} <span className="topline-dot">·</span> v1.2</span></div>
      {w.error && <div className="alert-banner" role="alert"><div><b>No se ha podido completar una operación</b><p>{w.error}</p></div><button className="icon-button" aria-label="Cerrar error" onClick={() => w.setError('')}><X size={17} /></button></div>}
      {w.notice && <div className="notice-banner" role="status"><span>{w.notice}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => w.setNotice('')}><X size={15} /></button></div>}
      {w.busy && <div className="analysis-progress" role="status"><LoaderCircle className="spin" size={21} /><div><b>Trabajando en tu navegador</b><p>{w.stage}</p></div><button className="text-button" onClick={w.cancel}>Cancelar</button></div>}
      {w.view === 'lab' && (w.selected ? <AnalysisView record={w.selected} analyzed={w.analyzed} audioUrl={w.audioUrl} records={w.records} model={modelStale ? null : w.model} rubric={w.rubric} engines={w.engines} teacher={teacher} onChange={patch => w.change(w.selected!.id, patch)} onBack={() => w.setView('library')} onEngines={() => w.setView('engines')} referenceId={w.referenceId} referenceUrl={w.referenceUrl} onReference={w.reference} /> : <UploadArea busy={w.busy} onFiles={w.files} onDemo={w.demo} student={teacher ? undefined : studentName} />)}
      {w.view === 'library' && <LibraryView records={w.records} busy={w.busy} rubric={w.rubric} teacher={teacher} student={studentName} onSelect={w.select} onRemove={w.remove} onFiles={w.files} onDemo={w.demo} onImport={w.importFile} />}
      {w.view === 'engines' && teacher && <Suspense fallback={<div className="empty-table">Cargando motores…</div>}><EnginesView settings={w.engines} onSave={w.setEngines} submissions={w.allRecords.filter(r => r.student).length} /></Suspense>}
      {w.view === 'rubric' && teacher && <Suspense fallback={<div className="empty-table">Cargando rúbrica…</div>}><RubricEditor rubric={w.rubric} onSave={w.setRubric} onReset={w.restoreRubric} /></Suspense>}
      {w.view === 'learning' && teacher && <Suspense fallback={<div className="empty-table">Cargando laboratorio de aprendizaje…</div>}><LearningView records={w.allRecords} model={w.model} onModel={w.saveModel} onLibrary={() => w.setView('library')} /></Suspense>}
      <footer className="workspace-footer"><span>SONORA <span>Hecho para escuchar con criterio.</span></span>{teacher && <button className="text-button" onClick={() => w.setView('learning')}><CircleHelp size={14} /> Sobre el método</button>}</footer>
    </main></div>
  </div>;
}
