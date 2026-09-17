import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeFile, type AnalyzedAudio } from '../../services/audio';
import { decodePcm, encodeWavFloat32 } from '../../services/audio/wav';
import { createDemo, type DemoId } from '../../services/audio/demos';
import { library, parseDataset } from '../../services/library';
import { fetchCorpusCollection, fetchCorpusModel } from '../../services/corpus';
import { createReview, updateReview, type ReviewRecord } from '../../services/review';
import { createSaveQueue, type SaveQueue } from '../../services/save-queue';
import { isQuotaError, readStorageState, requestPersistentStorage, storageWarning } from '../../services/storage';
import { isModelStale, splitByFeatureVersion } from '../../services/learning/model';
import type { LocalModel, ModelSnapshot } from '../../services/learning/types';
import { loadSession, saveSession, clearSession, studentKey, type Session } from '../../services/session';
import { loadRubric, saveRubric, resetRubric } from '../../services/rubric-store';
import { loadEngineSettings, saveEngineSettings, type EngineSettings } from '../../services/engines';
import type { RubricConfig } from '../../services/scoring/rubric';

export type WorkspaceView = 'lab' | 'library' | 'learning' | 'rubric' | 'engines' | 'corpus' | 'guide';
const fileHash = async (file: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
const playbackBlob = (file: Blob, analysis: AnalyzedAudio) => analysis.features.file.container === 'aiff' ? new Blob([encodeWavFloat32(analysis.channels, analysis.sampleRate)], { type: 'audio/wav' }) : file;
const useAudioUrl = (blob: Blob | null) => {
  const [url, setUrl] = useState('');
  useEffect(() => { if (!blob) { setUrl(''); return; } const value = URL.createObjectURL(blob); setUrl(value); return () => URL.revokeObjectURL(value); }, [blob]);
  return url;
};
/** Campos que un estudiante puede modificar en su propia entrega. */
const STUDENT_FIELDS: (keyof ReviewRecord)[] = ['synopsis', 'reading'];

export default function useWorkspace() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [rubric, setRubricState] = useState<RubricConfig>(() => loadRubric());
  const [engines, setEnginesState] = useState<EngineSettings>(() => loadEngineSettings());
  const [allRecords, setAllRecords] = useState<ReviewRecord[]>([]), recordsRef = useRef<ReviewRecord[]>([]);
  const [model, setModel] = useState<LocalModel | null>(null);
  const [modelHistory, setModelHistory] = useState<ModelSnapshot[]>([]);
  const [audioIds, setAudioIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<WorkspaceView>('lab');
  const [selectedId, setSelectedId] = useState('');
  const [analyzed, setAnalyzed] = useState<AnalyzedAudio | null>(null), [blob, setBlob] = useState<Blob | null>(null);
  const [referenceId, setReferenceId] = useState(''), [referenceBlob, setReferenceBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false), [stage, setStage] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const saves = useRef<SaveQueue | null>(null);
  if (!saves.current) saves.current = createSaveQueue(record => library.save(record), {
    onPendingChange: setSaving,
    onError: error => setError(isQuotaError(error)
      ? 'No queda espacio en este navegador para guardar la corrección. Exporta la colección, elimina muestras que ya no necesites y vuelve a intentarlo.'
      : 'No se pudo guardar la última corrección. Exporta el informe antes de cerrar y comprueba el espacio disponible.'),
  });
  const saveQueue = saves.current;
  const referenceRequest = useRef(0);
  const audioUrl = useAudioUrl(blob), referenceUrl = useAudioUrl(referenceBlob);
  const isTeacher = session?.role === 'teacher';
  const ownKey = session?.role === 'student' && session.studentName ? studentKey(session.studentName) : '';
  const owns = (r: ReviewRecord) => !!ownKey && !!r.student && studentKey(r.student.name) === ownKey;
  const records = isTeacher ? allRecords : allRecords.filter(owns);
  const maxManual = rubric.totalPoints + rubric.bonus.points;
  const replaceRecords = (next: ReviewRecord[]) => { recordsRef.current = next; setAllRecords(next); };
  const refresh = async () => { const [items, ids] = await Promise.all([library.list(), library.audioIds()]); replaceRecords(items); setAudioIds(new Set(ids)); };
  useEffect(() => { let live = true; Promise.all([library.list(), library.model(), library.modelHistory(), library.audioIds()]).then(([items, savedModel, history, ids]) => { if (live) { replaceRecords(items); setModel(savedModel ?? null); setModelHistory(history); setAudioIds(new Set(ids)); } }).catch(() => { if (live) setError('No se puede abrir el almacenamiento local. Permite el almacenamiento de este sitio para guardar tu colección.'); }); return () => { live = false; abort.current?.abort(); void saveQueue.flush(); }; }, [saveQueue]);
  // El audio vive en IndexedDB: sin persistencia concedida el navegador puede desalojarlo sin avisar.
  useEffect(() => { let live = true; void requestPersistentStorage().then(() => readStorageState()).then(state => { const warning = storageWarning(state); if (live && warning) setNotice(warning); }); return () => { live = false; }; }, []);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (saving > 0) { void saveQueue.flush(); event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [saving, saveQueue]);

  const resetSelection = () => { referenceRequest.current++; setSelectedId(''); setAnalyzed(null); setBlob(null); setReferenceId(''); setReferenceBlob(null); };
  const enter = (next: Session) => { saveSession(next); setSession(next); resetSelection(); setView('lab'); setError(''); setNotice(''); };
  const leave = () => { abort.current?.abort(); void saveQueue.flush(); clearSession(); setSession(null); resetSelection(); setView('lab'); setError(''); setNotice(''); };
  const setRubric = (next: RubricConfig) => { try { setRubricState(saveRubric(next)); setNotice('Rúbrica guardada en este navegador. Las notas se recalculan con ella.'); } catch (e) { setError(e instanceof Error ? e.message : 'Rúbrica inválida.'); } };
  const updateEngines = (next: EngineSettings) => { const saved = saveEngineSettings(next); setEnginesState(next); return saved; };
  const setEngines = (next: EngineSettings) => {
    if (!updateEngines(next)) { setError('El navegador impide guardar los motores. Los ajustes solo estarán disponibles durante esta sesión.'); return; }
    setNotice(next.engine === 'local' ? 'Motores guardados: segunda opinión con el modelo local.' : `Motores guardados: ${next.engine} · ${next.models[next.engine]} · ${next.analysisMode === 'refuerzo' ? 'refuerzo del modelo local' : 'escucha independiente'} · feedback ${next.feedbackWriter === 'ia' ? 'redactado por IA' : 'local'}${next.studentAccess ? ' · lectura orientativa activa para estudiantes' : ''}.`); setView('lab');
  };
  const restoreRubric = () => { setRubricState(resetRubric()); setNotice('Rúbrica restablecida a la original.'); };

  const change = (id: string, patch: Partial<ReviewRecord>) => {
    const current = recordsRef.current.find(r => r.id === id); if (!current) return;
    if (!isTeacher) {
      if (!owns(current)) return;
      patch = Object.fromEntries(Object.entries(patch).filter(([k]) => STUDENT_FIELDS.includes(k as keyof ReviewRecord) && (k !== 'reading' || (engines.studentAccess && !current.reading)))) as Partial<ReviewRecord>;
      if (!Object.keys(patch).length) return;
    }
    try {
      const next = updateReview(current, patch, maxManual);
      replaceRecords(recordsRef.current.map(r => r.id === id ? next : r));
      saveQueue.queue(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Cambio inválido.'); }
  };
  /**
   * Guarda una medición repetida sobre el mismo audio. No es una edición: no pasa por el filtro de
   * campos del estudiante y la puede provocar cualquier rol al abrir la muestra. Al cambiar
   * `features`, `updateReview` mueve `trainingUpdatedAt` y el modelo caduca, que es lo correcto.
   * Puede cambiar la parte técnica calculada de una nota ya publicada sin que nadie lo pida, así que
   * se avisa siempre con un aviso: la escritura nunca es invisible.
   */
  const refreshFeatures = (id: string, features: ReviewRecord['features']) => {
    const current = recordsRef.current.find(r => r.id === id);
    if (!current || current.features.version === features.version) return;
    const next = updateReview(current, { features }, maxManual);
    replaceRecords(recordsRef.current.map(r => r.id === id ? next : r));
    saveQueue.queue(next);
    setNotice('Esta muestra se ha vuelto a medir con la versión actual de las características.');
  };
  const select = async (record: ReviewRecord) => {
    if (abort.current) return;
    if (!isTeacher && !owns(record)) return;
    referenceRequest.current++;
    setView('lab'); setSelectedId(record.id); setAnalyzed(null); setBlob(null); setReferenceId(''); setReferenceBlob(null); setError('');
    const controller = new AbortController(); abort.current = controller; setBusy(true); setStage('Abriendo la muestra…');
    try {
      const audio = await library.audio(record.id);
      if (audio) {
        const result = await analyzeFile(new File([audio], record.name, { type: audio.type }), setStage, controller.signal);
        if (!controller.signal.aborted) {
          setBlob(playbackBlob(audio, result)); setAnalyzed(result);
          // La nota publicada está congelada en `publishedGrade`, así que reanalizar no la mueve: vale para cualquier rol.
          refreshFeatures(record.id, result.features);
        }
      }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudo abrir la muestra.'); }
    finally { setBusy(false); setStage(''); abort.current = null; }
  };

  const files = async (inputs: File[], origin: ReviewRecord['origin'] = 'real') => {
    if (!inputs.length || abort.current || !session) return;
    if (!isTeacher) origin = 'real';
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(''); setNotice('');
    const errors: string[] = []; let added = 0, duplicates = 0;
    let first: { record: ReviewRecord; analysis: AnalyzedAudio | null; audio: File } | null = null;
    const student = session.role === 'student' && session.studentName ? { name: session.studentName, submittedAt: new Date().toISOString() } : undefined;
    try {
      await saveQueue.flush();
      for (const [i, file] of inputs.entries()) {
        if (controller.signal.aborted) break;
        const prefix = `${i + 1}/${inputs.length} · ${file.name}`;
        try {
          if (!/\.(wav|wave|aif|aiff|aifc|flac)$/i.test(file.name)) throw new Error('Usa un archivo WAV, AIFF o FLAC.');
          if (file.size > 200 * 1024 * 1024) throw new Error('El máximo es 200 MB por archivo.');
          if (file.size < 12) throw new Error('El archivo está vacío o incompleto.');
          setStage(`${prefix} · comprobando duplicados…`);
          const id = await fileHash(file); if (controller.signal.aborted) break;
          const existing = await library.get(id);
          if (existing) {
            if (student && existing.student && studentKey(existing.student.name) !== ownKey) throw new Error('Este archivo ya fue entregado por otra persona. Habla con tu profesor.');
            const claimed = student && !existing.student ? updateReview(existing, { student }, maxManual) : existing;
            await library.save(claimed, file); duplicates++;
            if (!first) first = { record: claimed, analysis: null, audio: file };
            continue;
          }
          const analysis = await analyzeFile(file, text => setStage(`${prefix} · ${text}`), controller.signal);
          if (controller.signal.aborted) break;
          const record = createReview(id, file.name, analysis.features, origin);
          if (student) record.student = student;
          if (origin === 'synthetic') { record.sourceGroup = 'demo-campana'; record.notes = 'Ejemplo sintético generado para explorar la aplicación. Excluido del entrenamiento real.'; }
          await library.save(record, file); added++;
          if (!first) first = { record, analysis, audio: file };
          await refresh();
        } catch (e) { if (!controller.signal.aborted) errors.push(`${file.name}: ${e instanceof Error ? e.message : 'No se pudo analizar.'}`); }
      }
      await refresh();
      if (first && !controller.signal.aborted) {
        referenceRequest.current++;
        const analysis = first.analysis ?? await analyzeFile(first.audio, setStage, controller.signal);
        setSelectedId(first.record.id); setAnalyzed(analysis); setBlob(playbackBlob(first.audio, analysis)); setView('lab'); setReferenceId(''); setReferenceBlob(null);
      }
      setNotice(student ? `${added + duplicates} entrega(s) registrada(s) a nombre de ${student.name}${controller.signal.aborted ? ' · carga cancelada' : ''}.` : `${added} muestra(s) añadida(s)${duplicates ? ` · ${duplicates} duplicado(s) reconocido(s)` : ''}${controller.signal.aborted ? ' · carga cancelada' : ''}.`);
    } catch (e) { if (!controller.signal.aborted) errors.push(e instanceof Error ? e.message : 'No se pudo completar la carga.'); }
    finally { setError(errors.join('\n')); setBusy(false); setStage(''); abort.current = null; }
  };
  /** Reanaliza, uno a uno, los registros de versiones anteriores que tienen audio guardado. */
  const reanalyze = async () => {
    if (!isTeacher || abort.current) return;
    const outdated = splitByFeatureVersion(recordsRef.current).stale;
    const withAudio = outdated.filter(r => audioIds.has(r.id));
    if (!withAudio.length) { setNotice(`${outdated.length} muestra(s) en una versión anterior, ninguna con audio guardado: siguen puntuando, pero no entrenan hasta volver a subir el original.`); return; }
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(''); setNotice('');
    const errors: string[] = []; let done = 0;
    try {
      for (const [i, record] of withAudio.entries()) {
        if (controller.signal.aborted) break;
        try {
          const audio = await library.audio(record.id);
          if (!audio) continue;
          const result = await analyzeFile(new File([audio], record.name, { type: audio.type }), text => setStage(`${i + 1}/${withAudio.length} · ${record.name} · ${text}`), controller.signal);
          if (controller.signal.aborted) break;
          refreshFeatures(record.id, result.features); done++;
        } catch (e) { if (!controller.signal.aborted) errors.push(`${record.name}: ${e instanceof Error ? e.message : 'No se pudo reanalizar.'}`); }
      }
      await saveQueue.flush(); await refresh();
      const skipped = outdated.length - withAudio.length;
      setNotice(`${done} muestra(s) reanalizada(s)${skipped ? ` · ${skipped} sin audio, siguen puntuables` : ''}${errors.length ? ` · ${errors.length} con error` : ''}${controller.signal.aborted ? ' · cancelado' : ''}.`);
    } catch (e) { if (!controller.signal.aborted) errors.push(e instanceof Error ? e.message : 'No se pudo reanalizar.'); }
    finally { setError(errors.join('\n')); setBusy(false); setStage(''); abort.current = null; }
  };
  const demo = (id: DemoId) => { if (!busy && isTeacher) void files([createDemo(id)], 'synthetic'); };
  const remove = async (record: ReviewRecord) => {
    if (!isTeacher) return;
    try { await saveQueue.flush(); await library.remove(record.id); if (selectedId === record.id) { setSelectedId(''); setBlob(null); setAnalyzed(null); } await refresh(); setNotice('Muestra eliminada de este navegador.'); }
    catch { setError('No se pudo eliminar la muestra.'); }
  };
  const importFile = async (file: File) => {
    if (busy || !isTeacher) return; setBusy(true); setError(''); setStage('Comprobando colección…');
    try { if (file.size > 50 * 1024 * 1024) throw new Error('El JSON supera 50 MB.'); const imported = parseDataset(await file.text()); await saveQueue.flush(); const result = await library.importRecords(imported); await refresh(); setNotice(`${result.added} registros importados · ${result.skipped} duplicados conservados. El JSON no incluye audio.`); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo importar.'); }
    finally { setBusy(false); setStage(''); }
  };
  /** Importa el corpus publicado (public/corpus) y, si existe, su modelo entrenado. */
  const importCorpus = async (withModel: boolean) => {
    if (busy || !isTeacher) return; setBusy(true); setError(''); setStage('Descargando la colección del corpus…');
    try {
      const records = await fetchCorpusCollection();
      await saveQueue.flush(); const result = await library.importRecords(records); await refresh();
      let modelNote = '';
      if (withModel) {
        setStage('Descargando el modelo entrenado…');
        const published = await fetchCorpusModel();
        if (published) { await library.saveModel(published); setModel(published); setModelHistory(await library.modelHistory()); modelNote = ' · modelo entrenado cargado'; }
      }
      setNotice(`Corpus importado: ${result.added} registros nuevos · ${result.skipped} ya estaban${modelNote}. Las mediciones y etiquetas se guardan en este navegador; el audio no.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo importar el corpus.'); }
    finally { setBusy(false); setStage(''); }
  };
  const reference = async (id: string) => {
    if (!isTeacher) return;
    const request = ++referenceRequest.current; setReferenceId(id); setReferenceBlob(null);
    try {
      let source = id ? await library.audio(id) : null;
      if (source && recordsRef.current.find(r => r.id === id)?.features.file.container === 'aiff') {
        const decoded = decodePcm(await source.arrayBuffer());
        if (decoded) source = new Blob([encodeWavFloat32(decoded.channels, decoded.sampleRate)], { type: 'audio/wav' });
      }
      if (request === referenceRequest.current) setReferenceBlob(source ?? null);
    }
    catch { setError('No se pudo cargar la referencia.'); }
  };
  const saveModel = async (next: LocalModel) => { if (!isTeacher) return; await library.saveModel(next); setModel(next); setModelHistory(await library.modelHistory()); setNotice('Modelo y resultados de validación guardados en este navegador.'); };
  /**
   * Vuelve a la zona de carga del laboratorio sin salir de él. No se pierde nada: el registro ya
   * está guardado. Si la muestra todavía se estaba abriendo, se cancela esa lectura: quien pulsa
   * «subir otro archivo» quiere salir de este, no esperar a que termine de analizarse.
   */
  const clearSelection = () => { abort.current?.abort(); resetSelection(); setView('lab'); };
  const modelStale = useMemo(() => isModelStale(model, allRecords), [model, allRecords]);
  return { session, enter, leave, isTeacher, rubric, setRubric, restoreRubric, engines, setEngines, updateEngines, records, allRecords, model, modelHistory, modelStale, audioIds, reanalyze, view, setView, selected: records.find(r => r.id === selectedId), analyzed, audioUrl, referenceUrl, referenceId, reference, busy, stage, error, notice, saving, setError, setNotice, change, select, files, demo, remove, importFile, importCorpus, saveModel, clearSelection, cancel: () => abort.current?.abort() };
}
