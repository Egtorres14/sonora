import { lazy, Suspense } from 'react';
import { Activity, ArrowUpRight, AudioLines, BookOpen, ChevronRight, CircleHelp, Database, Layers3, LoaderCircle, LockKeyhole, X } from 'lucide-react';
import useWorkspace, { type WorkspaceView } from './components/workspace/useWorkspace';
import UploadArea from './components/workspace/UploadArea';
import AnalysisView from './components/workspace/AnalysisView';
import LibraryView from './components/workspace/LibraryView';
const LearningView = lazy(() => import('./components/workspace/LearningView'));

const NAV = [{ id: 'lab', label: 'Laboratorio', icon: Activity, number: '01' }, { id: 'library', label: 'Biblioteca', icon: Database, number: '02' }, { id: 'learning', label: 'Modelo local', icon: Layers3, number: '03' }] as const;

export default function App() {
  const w = useWorkspace();
  const modelStale = w.model && (w.model.trainingSampleIds.some(id => !w.records.some(r => r.id === id)) || w.records.some(r => w.model!.trainingSampleIds.includes(r.id) && r.updatedAt > w.model!.trainedAt));
  return <div className="app-shell"><a className="skip-link" href="#main-content">Saltar al contenido</a><aside className="sidebar"><a href="#" className="brand" onClick={e => { e.preventDefault(); w.setView('lab'); }} aria-label="Sonora, laboratorio de audio"><AudioLines size={30} strokeWidth={1.5} /><span>sonora<span className="brand-dot">.</span><small>LABORATORIO DE AUDIO</small></span></a><div className="sidebar-section-label">ESPACIO DE TRABAJO</div><nav aria-label="Navegación principal">{NAV.map(item => <button key={item.id} aria-current={w.view === item.id ? 'page' : undefined} className={w.view === item.id ? 'active' : ''} onClick={() => w.setView(item.id as WorkspaceView)}><item.icon size={19} strokeWidth={1.5} /><span>{item.label}</span>{item.id === 'library' && w.records.length ? <b>{w.records.length}</b> : <small>{item.number}</small>}</button>)}</nav><div className="sidebar-lesson"><div className="lesson-icon"><BookOpen size={19} /></div><span className="eyebrow">APRENDER A ESCUCHAR</span><h3>Mejores datos.<br />Mejores decisiones.</h3><p>Construye una colección con ejemplos verificados por ti.</p><button className="text-button" onClick={() => w.setView('learning')}>Cómo empezar <ArrowUpRight size={15} /></button></div><div className="sidebar-bottom"><span className="status-dot" /><div><b>Tu audio se queda aquí</b><small>Procesamiento y almacenamiento local</small></div><LockKeyhole size={16} /></div></aside>
    <div className="workspace-shell"><header className="workspace-header"><div className="breadcrumb"><span>Espacio de trabajo</span><ChevronRight size={13} /><b>{NAV.find(n => n.id === w.view)?.label}</b></div><div className="header-right"><span className="local-badge"><span className="status-dot" />Motor local activo</span><span className="header-divider" /><span className="profile-avatar" title="Espacio local del profesor">P</span></div></header><main id="main-content" className="workspace-content">
      <div className="workspace-topline"><span className="eyebrow">{w.view === 'lab' ? 'ANÁLISIS & EVIDENCIA' : w.view === 'library' ? 'MUESTRAS & ANOTACIONES' : 'DATOS & VALIDACIÓN'}</span><span className="text-small muted">{w.saving ? 'Guardando cambios…' : 'Espacio local'} <span className="topline-dot">·</span> v1.0</span></div>
      {w.error && <div className="alert-banner" role="alert"><div><b>No se ha podido completar una operación</b><p>{w.error}</p></div><button className="icon-button" aria-label="Cerrar error" onClick={() => w.setError('')}><X size={17} /></button></div>}
      {w.notice && <div className="notice-banner" role="status"><span>{w.notice}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => w.setNotice('')}><X size={15} /></button></div>}
      {w.busy && <div className="analysis-progress" role="status"><LoaderCircle className="spin" size={21} /><div><b>Trabajando en tu navegador</b><p>{w.stage}</p></div><button className="text-button" onClick={w.cancel}>Cancelar</button></div>}
      {w.view === 'lab' && (w.selected ? <AnalysisView record={w.selected} analyzed={w.analyzed} audioUrl={w.audioUrl} records={w.records} model={modelStale ? null : w.model} onChange={patch => w.change(w.selected!.id, patch)} onBack={() => w.setView('library')} referenceId={w.referenceId} referenceUrl={w.referenceUrl} onReference={w.reference} /> : <UploadArea busy={w.busy} onFiles={w.files} onDemo={w.demo} />)}
      {w.view === 'library' && <LibraryView records={w.records} busy={w.busy} onSelect={w.select} onRemove={w.remove} onFiles={w.files} onDemo={w.demo} onImport={w.importFile} />}
      {w.view === 'learning' && <Suspense fallback={<div className="empty-table">Cargando laboratorio de aprendizaje…</div>}><LearningView records={w.records} model={w.model} onModel={w.saveModel} onLibrary={() => w.setView('library')} /></Suspense>}
      <footer className="workspace-footer"><span>SONORA <span>Hecho para escuchar con criterio.</span></span><button className="text-button" onClick={() => w.setView('learning')}><CircleHelp size={14} /> Sobre el método</button></footer>
    </main></div>
  </div>;
}
