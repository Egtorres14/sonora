import { useEffect, useRef, useState } from 'react';
import { analyzeFile, type AnalyzedAudio } from '../../services/audio';
import { decodePcm, encodeWavFloat32 } from '../../services/audio/wav';
import { createDemo, type DemoId } from '../../services/audio/demos';
import { library, parseDataset } from '../../services/library';
import { createReview, updateReview, type ReviewRecord } from '../../services/review';
import type { LocalModel } from '../../services/learning/types';

export type WorkspaceView = 'lab' | 'library' | 'learning';
const fileHash = async (file: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
const playbackBlob = (file: Blob, analysis: AnalyzedAudio) => analysis.features.file.container === 'aiff' ? new Blob([encodeWavFloat32(analysis.channels, analysis.sampleRate)], { type: 'audio/wav' }) : file;
const useAudioUrl = (blob: Blob | null) => {
  const [url, setUrl] = useState('');
  useEffect(() => { if (!blob) { setUrl(''); return; } const value = URL.createObjectURL(blob); setUrl(value); return () => URL.revokeObjectURL(value); }, [blob]);
  return url;
};

export default function useWorkspace() {
  const [records, setRecords] = useState<ReviewRecord[]>([]), recordsRef = useRef<ReviewRecord[]>([]);
  const [model, setModel] = useState<LocalModel | null>(null);
  const [view, setView] = useState<WorkspaceView>('lab');
  const [selectedId, setSelectedId] = useState('');
  const [analyzed, setAnalyzed] = useState<AnalyzedAudio | null>(null), [blob, setBlob] = useState<Blob | null>(null);
  const [referenceId, setReferenceId] = useState(''), [referenceBlob, setReferenceBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false), [stage, setStage] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(0);
  const abort = useRef<AbortController | null>(null), saveQueue = useRef(Promise.resolve());
  const referenceRequest = useRef(0);
  const audioUrl = useAudioUrl(blob), referenceUrl = useAudioUrl(referenceBlob);
  const replaceRecords = (next: ReviewRecord[]) => { recordsRef.current = next; setRecords(next); };
  const refresh = async () => replaceRecords(await library.list());
  useEffect(() => { let live = true; Promise.all([library.list(), library.model()]).then(([items, savedModel]) => { if (live) { replaceRecords(items); setModel(savedModel ?? null); } }).catch(() => { if (live) setError('No se puede abrir el almacenamiento local. Permite el almacenamiento de este sitio para guardar tu colección.'); }); return () => { live = false; abort.current?.abort(); }; }, []);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (saving > 0) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [saving]);

  const change = (id: string, patch: Partial<ReviewRecord>) => {
    const current = recordsRef.current.find(r => r.id === id); if (!current) return;
    try {
      const next = updateReview(current, patch);
      replaceRecords(recordsRef.current.map(r => r.id === id ? next : r)); setSaving(n => n + 1);
      saveQueue.current = saveQueue.current.then(() => library.save(next)).catch(() => setError('No se pudo guardar la última corrección. Exporta el informe antes de cerrar y comprueba el espacio disponible.')).finally(() => setSaving(n => n - 1));
    } catch (e) { setError(e instanceof Error ? e.message : 'Cambio inválido.'); }
  };
  const select = async (record: ReviewRecord) => {
    if (abort.current) return;
    referenceRequest.current++;
    setView('lab'); setSelectedId(record.id); setAnalyzed(null); setBlob(null); setReferenceId(''); setReferenceBlob(null); setError('');
    const controller = new AbortController(); abort.current = controller; setBusy(true); setStage('Abriendo la muestra…');
    try {
      const audio = await library.audio(record.id);
      if (audio) {
        const result = await analyzeFile(new File([audio], record.name, { type: audio.type }), setStage, controller.signal);
        if (!controller.signal.aborted) { setBlob(playbackBlob(audio, result)); setAnalyzed(result); }
      }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudo abrir la muestra.'); }
    finally { setBusy(false); setStage(''); abort.current = null; }
  };

  const files = async (inputs: File[], origin: ReviewRecord['origin'] = 'real') => {
    if (!inputs.length || abort.current) return;
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(''); setNotice('');
    const errors: string[] = []; let added = 0, duplicates = 0;
    let first: { record: ReviewRecord; analysis: AnalyzedAudio | null; audio: File } | null = null;
    try {
      await saveQueue.current;
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
            await library.save(existing, file); duplicates++;
            if (!first) first = { record: existing, analysis: null, audio: file };
            continue;
          }
          const analysis = await analyzeFile(file, text => setStage(`${prefix} · ${text}`), controller.signal);
          if (controller.signal.aborted) break;
          const record = createReview(id, file.name, analysis.features, origin);
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
      setNotice(`${added} muestra(s) añadida(s)${duplicates ? ` · ${duplicates} duplicado(s) reconocido(s)` : ''}${controller.signal.aborted ? ' · carga cancelada' : ''}.`);
    } catch (e) { if (!controller.signal.aborted) errors.push(e instanceof Error ? e.message : 'No se pudo completar la carga.'); }
    finally { setError(errors.join('\n')); setBusy(false); setStage(''); abort.current = null; }
  };
  const demo = (id: DemoId) => { if (!busy) void files([createDemo(id)], 'synthetic'); };
  const remove = async (record: ReviewRecord) => {
    try { await saveQueue.current; await library.remove(record.id); if (selectedId === record.id) { setSelectedId(''); setBlob(null); setAnalyzed(null); } await refresh(); setNotice('Muestra eliminada de este navegador.'); }
    catch { setError('No se pudo eliminar la muestra.'); }
  };
  const importFile = async (file: File) => {
    if (busy) return; setBusy(true); setError(''); setStage('Comprobando colección…');
    try { if (file.size > 50 * 1024 * 1024) throw new Error('El JSON supera 50 MB.'); const imported = parseDataset(await file.text()); await saveQueue.current; const result = await library.importRecords(imported); await refresh(); setNotice(`${result.added} registros importados · ${result.skipped} duplicados conservados. El JSON no incluye audio.`); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo importar.'); }
    finally { setBusy(false); setStage(''); }
  };
  const reference = async (id: string) => {
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
  const saveModel = async (next: LocalModel) => { await library.saveModel(next); setModel(next); setNotice('Modelo y resultados de validación guardados en este navegador.'); };
  return { records, model, view, setView, selected: records.find(r => r.id === selectedId), analyzed, audioUrl, referenceUrl, referenceId, reference, busy, stage, error, notice, saving, setError, setNotice, change, select, files, demo, remove, importFile, saveModel, cancel: () => abort.current?.abort() };
}
