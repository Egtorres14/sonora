import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { AnalyzedAudio } from '../../services/audio';
import type { LocalModel } from '../../services/learning/types';
import { predictLocalModel } from '../../services/learning/model';
import { EFFECTS, type ReviewRecord } from '../../services/review';
import { loadSettings, saveSettings, loadKey, saveKey, clearAllKeys } from '../../services/settings';
import { evaluateProject } from '../../services/evaluation';
import SettingsPanel from '../SettingsPanel';

interface Props { record: ReviewRecord; analyzed: AnalyzedAudio | null; model: LocalModel | null; onChange: (patch: Partial<ReviewRecord>) => void }
export default function ModelAdvice({ record, analyzed, model, onChange }: Props) {
  const [settings, setSettings] = useState(loadSettings);
  const [keys, setKeys] = useState({ gemini: loadKey('gemini'), openai: loadKey('openai'), anthropic: loadKey('anthropic') });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [stage, setStage] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const seen = model?.trainingSampleIds.includes(record.id) || !!record.sourceGroup.trim() && model?.trainingGroupIds.includes(record.sourceGroup.trim().toLowerCase());
  const prediction = useMemo(() => {
    if (!model || seen) return [];
    try { return predictLocalModel(model, record.features); } catch { return []; }
  }, [model, seen, record.features]);
  const request = async () => {
    if (!analyzed || !keys[settings.provider].trim()) return;
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError('');
    try {
      const ai = await evaluateProject({ fileName: record.name, analyzed, synopsis: record.synopsis, context: record.context, llm: { ...settings, apiKey: keys[settings.provider], signal: controller.signal }, onStage: setStage });
      if (!controller.signal.aborted) onChange({ ai });
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo consultar al proveedor.'); }
    finally { setBusy(false); setStage(''); abort.current = null; }
  };
  const ai = record.ai;
  return <div className="model-advice"><div className="local-advice"><h4>Clasificador local</h4>{!model ? <p>No hay un modelo disponible. Reúne muestras etiquetadas en la biblioteca y entrénalo desde «Modelo local».</p> : seen ? <p>Esta muestra o su grupo ya formaron parte del entrenamiento. Una predicción aquí no sería evidencia independiente.</p> : <div className="suggestion-list">{prediction.map(p => <div key={p.effect}><b>{EFFECTS.find(e => e.id === p.effect)?.label}</b><span>{p.predicted === null ? 'Se abstiene' : p.predicted ? 'Sugiere presencia' : 'Sugiere ausencia'}</span><p>{p.voteShare === null ? '' : `${Math.round(p.voteShare * 100)} % de votos por presencia. `}{p.explanation}</p></div>)}</div>}</div>
    <details className="external-advice"><summary><Sparkles size={16} /> Consultar una IA externa <span>Opcional</span></summary><p className="notice">Al pulsar «Pedir segunda opinión», se envían el audio preparado o las imágenes, las métricas, el nombre del archivo, la sinopsis y el contexto al proveedor elegido. Puede tener coste. Las claves se usan en tu navegador.</p><SettingsPanel settings={settings} onSettingsChange={next => { if (!next.rememberKeys) clearAllKeys(); else Object.entries(keys).forEach(([p, key]) => saveKey(p as keyof typeof keys, key, true)); setSettings(next); saveSettings(next); }} apiKey={keys[settings.provider]} onApiKeyChange={key => { setKeys(prev => ({ ...prev, [settings.provider]: key })); saveKey(settings.provider, key, settings.rememberKeys); }} durationSec={record.features.format.duration} /><button className="button primary" disabled={busy || !analyzed || !keys[settings.provider].trim()} onClick={request}><Sparkles size={15} />{busy ? 'Consultando…' : 'Pedir segunda opinión'}</button>{busy && <button className="text-button" onClick={() => abort.current?.abort()}>Cancelar consulta</button>}{stage && <p role="status">{stage}</p>}{!analyzed && <p className="muted">Carga el audio original para habilitar la consulta.</p>}{error && <p role="alert" className="error-text">{error}</p>}</details>
    {ai && <div className="ai-response"><span className="eyebrow">SUGERENCIA EXTERNA · {ai.meta.modelLabel}</span><p>{ai.resumen_y_calificacion_final.comentarios_generales}</p><div className="suggestion-list">{ai.evaluacion_creatividad_y_procesamiento.herramientas_utilizadas.map(tool => <div key={tool.herramienta}><b>{tool.herramienta.replace('_', ' ')}</b><span>{tool.detectado ? 'Indica presencia' : 'No detectado'}</span><p>{tool.comentarios}</p></div>)}</div><p className="notice">{ai.resumen_y_calificacion_final.limitaciones}</p><small>{ai.meta.runs} ejecución(es) · {ai.meta.agreement === null ? 'Sin contraste entre ejecuciones' : `${Math.round(ai.meta.agreement * 100)} % de acuerdo`} · coste orientativo ${ai.meta.estimatedCostUsd.toFixed(4)}</small></div>}
  </div>;
}
