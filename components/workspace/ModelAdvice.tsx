import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { AnalyzedAudio } from '../../services/audio';
import type { LocalModel } from '../../services/learning/types';
import { predictLocalModel } from '../../services/learning/model';
import { EFFECTS, type ReviewRecord } from '../../services/review';
import { engineCost, loadKey, type EngineSettings } from '../../services/engines';
import { findModel } from '../../services/llm/catalog';
import { evaluateProject } from '../../services/evaluation';
import type { EvaluationHints } from '../../services/llm/types';

interface Props { record: ReviewRecord; analyzed: AnalyzedAudio | null; model: LocalModel | null; engines: EngineSettings; teacher: boolean; onChange: (patch: Partial<ReviewRecord>) => void; onEngines?: () => void }

/** Segunda opinión: modelo local (profesor) o proveedor externo elegido en «Motores de IA». */
export default function ModelAdvice({ record, analyzed, model, engines, teacher, onChange, onEngines }: Props) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [stage, setStage] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const seen = model?.trainingSampleIds.includes(record.id) || !!record.sourceGroup.trim() && model?.trainingGroupIds.includes(record.sourceGroup.trim().toLowerCase());
  const prediction = useMemo(() => {
    if (!model || seen) return [];
    try { return predictLocalModel(model, record.features); } catch { return []; }
  }, [model, seen, record.features]);
  const external = engines.engine === 'local' ? null : engines.engine;
  const apiKey = external ? loadKey(external) : '';
  const modelInfo = external ? findModel(engines.models[external]) : null;
  const runs = teacher ? engines.runs : 1;
  const cost = external ? engineCost(engines, record.features.format.duration, runs) : 0;
  const alreadyRead = !teacher && !!record.ai;

  const reinforce = engines.analysisMode === 'refuerzo';
  /** Modo refuerzo: solo el profesor comparte con el modelo el clasificador local y sus decisiones (el estudiante no ve decisiones sin publicar). */
  const hints: EvaluationHints | undefined = teacher && reinforce ? {
    local: prediction.map(p => ({ effect: p.effect, predicted: p.predicted, voteShare: p.voteShare, balancedAccuracy: p.validation?.balancedAccuracy ?? null })),
    teacher: EFFECTS.map(e => ({ effect: e.id, label: record.labels[e.id], evidence: record.evidence[e.id] ?? '' })),
    overprocessing: record.overprocessing === 'unknown' ? undefined : record.overprocessing,
    extra: record.extra,
  } : undefined;

  const request = async () => {
    if (!analyzed || !external || !apiKey.trim()) return;
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError('');
    try {
      const ai = await evaluateProject({ fileName: record.name, analyzed, synopsis: record.synopsis, context: record.context, audience: teacher ? 'teacher' : 'student', hints, llm: { provider: external, model: engines.models[external], runs, apiKey, signal: controller.signal }, onStage: setStage });
      if (!controller.signal.aborted) onChange({ ai });
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo consultar al proveedor.'); }
    finally { setBusy(false); setStage(''); abort.current = null; }
  };
  const ai = record.ai;

  return <div className="model-advice">
    {teacher && <div className="local-advice"><h4>Clasificador local</h4>{!model ? <p>No hay un modelo disponible. Reúne muestras etiquetadas en la biblioteca y entrénalo desde «Modelo local».</p> : seen ? <p>Esta muestra o su grupo ya formaron parte del entrenamiento. Una predicción aquí no sería evidencia independiente.</p> : <div className="suggestion-list">{prediction.map(p => <div key={p.effect}><b>{EFFECTS.find(e => e.id === p.effect)?.label}</b><span>{p.predicted === null ? 'Se abstiene' : p.predicted ? 'Sugiere presencia' : 'Sugiere ausencia'}</span><p>{p.voteShare === null ? '' : `${Math.round(p.voteShare * 100)} % de votos por presencia. `}{p.explanation}</p></div>)}</div>}</div>}
    {external ? <div className="external-advice">
      <div className="engine-summary-row"><span className="eyebrow"><Sparkles size={14} /> {modelInfo?.label ?? engines.models[external]}</span><span className="mono">{runs} ejecución{runs > 1 ? 'es' : ''} · {modelInfo?.free ? 'gratis' : `≈ ${cost.toFixed(3)} $`}{teacher && reinforce ? ' · refuerzo' : ''}</span>{teacher && onEngines && <button className="text-button" onClick={onEngines}>Cambiar motor</button>}</div>
      {teacher && <p className="notice">Se envían el audio preparado o las imágenes, las métricas, el nombre del archivo, la sinopsis y el contexto al proveedor{reinforce ? ', además de las sugerencias del clasificador local y tus decisiones actuales para que las contraste' : ''}. La clave es la guardada en «Motores de IA».</p>}
      {!apiKey.trim() ? <p className="error-text">Falta la clave de {modelInfo?.provider ?? external}. {teacher ? 'Añádela en «Motores de IA».' : 'Avisa a tu profesor.'}</p>
        : alreadyRead ? <p className="muted text-small">Ya tienes una lectura orientativa de esta entrega.</p>
        : <button className="button primary" disabled={busy || !analyzed} onClick={request}><Sparkles size={15} />{busy ? 'Consultando…' : teacher ? 'Pedir segunda opinión' : 'Pedir lectura orientativa'}</button>}
      {busy && <button className="text-button" onClick={() => abort.current?.abort()}>Cancelar consulta</button>}{stage && <p role="status">{stage}</p>}{!analyzed && <p className="muted">Carga el audio original para habilitar la consulta.</p>}{error && <p role="alert" className="error-text">{error}</p>}
    </div> : teacher ? <p className="muted text-small">Motor externo desactivado. Actívalo en «Motores de IA» si quieres una segunda opinión de Gemini, Claude u OpenAI.</p> : null}
    {ai && <div className="ai-response"><span className="eyebrow">{teacher ? 'SUGERENCIA EXTERNA' : 'LECTURA ORIENTATIVA'} · {ai.meta.modelLabel}</span>
      {!teacher && <p className="notice">Esto es lo que un modelo dice oír. No es tu nota: la pone tu profesor.</p>}
      {ai.evaluacion_creatividad_y_procesamiento.descripcion_sonora && <p>{ai.evaluacion_creatividad_y_procesamiento.descripcion_sonora}</p>}
      <p>{ai.resumen_y_calificacion_final.comentarios_generales}</p>
      {teacher && <div className="suggestion-list">{ai.evaluacion_creatividad_y_procesamiento.herramientas_utilizadas.map(tool => <div key={tool.herramienta}><b>{tool.herramienta.replace('_', ' ')}</b><span>{tool.detectado ? `Indica presencia · ${Math.round(tool.confianza * 100)} %` : 'No detectado'}</span><p>{tool.comentarios}</p></div>)}</div>}
      {!teacher && (ai.resumen_y_calificacion_final.fortalezas.length > 0 || ai.resumen_y_calificacion_final.mejoras.length > 0) && <div className="two-fields"><div><b className="text-small">Fortalezas</b><ul>{ai.resumen_y_calificacion_final.fortalezas.map((s, i) => <li key={i}>{s}</li>)}</ul></div><div><b className="text-small">Mejoras</b><ul>{ai.resumen_y_calificacion_final.mejoras.map((s, i) => <li key={i}>{s}</li>)}</ul></div></div>}
      <p className="notice">{ai.resumen_y_calificacion_final.limitaciones}</p>
      {ai.meta.warnings.filter(w => /audio|OpenRouter/i.test(w)).map((w, i) => <p key={i} className="notice">{w}</p>)}
      <small>{ai.meta.modalidad} · {ai.meta.runs} ejecución(es) · {ai.meta.agreement === null ? 'Sin contraste entre ejecuciones' : `${Math.round(ai.meta.agreement * 100)} % de acuerdo`} · coste orientativo ${ai.meta.estimatedCostUsd.toFixed(4)}</small></div>}
  </div>;
}
