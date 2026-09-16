import { useEffect, useState } from 'react';
import { Check, RotateCcw, Save, SlidersHorizontal, X } from 'lucide-react';
import { EFFECTS } from '../../services/review';
import { rubricTotal, toStored, fromStored, isDefaultRubric, type StoredRubric } from '../../services/rubric-store';
import { checkRubricFileName, type RubricConfig, type ToolId } from '../../services/scoring/rubric';
import { NAME_FIELDS, describeNamePattern } from '../../services/filename-rule';

interface Props { rubric: RubricConfig; onSave: (r: RubricConfig) => void; onReset: () => void }

const Num = ({ label, value, onChange, step = 0.5, min = 0, max = 100, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; hint?: string }) => (
  <label className="field"><span>{label}</span><input type="number" value={value} step={step} min={min} max={max} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} />{hint && <small>{hint}</small>}</label>
);

/**
 * Formato exigido del nombre de archivo, con una caja para probarlo. Sin probar, escribir una
 * plantilla es a ciegas: un error suspendería a toda la clase en este criterio sin que nadie lo viera.
 */
const NameFormat = ({ formal, onChange }: { formal: StoredRubric['formal']; onChange: (pattern: string) => void }) => {
  const [sample, setSample] = useState('');
  const [student, setStudent] = useState('');
  const pattern = formal.fileNamePattern ?? '';
  const verdict = sample.trim() ? checkRubricFileName(sample.trim(), formal, student.trim() || undefined) : null;
  return <div className="name-format">
    <label className="field"><span>Formato exigido del nombre de archivo</span>
      <input value={pattern} maxLength={200} placeholder="Ej.: {estudiante}_{estudiante}_ejercicio{numero}" onChange={e => onChange(e.target.value)} />
      <small>{pattern.trim() ? `Un nombre válido sería «${describeNamePattern(pattern)}».` : 'Vacío: solo se descartan nombres genéricos como «audio1» o «untitled».'}</small>
    </label>
    <ul className="name-fields">{NAME_FIELDS.map(f => <li key={f.token}><code>{f.token}</code> {f.help}</li>)}</ul>
    <div className="name-test">
      <label className="field"><span>Probar un nombre</span><input value={sample} placeholder="perez_ana_ejercicio3.wav" onChange={e => setSample(e.target.value)} /></label>
      <label className="field"><span>Como si lo entregara</span><input value={student} placeholder="Ana Pérez" onChange={e => setStudent(e.target.value)} /></label>
    </div>
    {verdict && <p className={`name-verdict ${verdict.ok ? 'ok' : 'bad'}`} data-testid="name-verdict">{verdict.ok ? <Check size={14} /> : <X size={14} />} {verdict.ok ? 'Puntuaría' : 'No puntuaría'}: {verdict.reason}</p>}
  </div>;
};

export default function RubricEditor({ rubric, onSave, onReset }: Props) {
  const [draft, setDraft] = useState<StoredRubric>(() => toStored(rubric));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(toStored(rubric)); setError(''); }, [rubric]);
  const total = rubricTotal(draft);
  const set = <K extends keyof StoredRubric>(key: K, patch: Partial<StoredRubric[K]>) => setDraft(d => ({ ...d, [key]: { ...d[key], ...patch } }));
  const toggleTool = (id: ToolId) => set('creative', { requiredTools: draft.creative.requiredTools.includes(id) ? draft.creative.requiredTools.filter(t => t !== id) : [...draft.creative.requiredTools, id] });
  const save = () => { try { onSave(fromStored(draft)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Rúbrica inválida.'); } };
  const tiers = draft.technical.clickTiers;

  return <div className="rubric-editor">
    <div className="page-title"><span className="eyebrow">CRITERIOS DE EVALUACIÓN</span><h2>La rúbrica es tuya.<br />Ajústala a cada <em>ejercicio.</em></h2><p>Los puntos y umbrales se aplican a todas las entregas de este navegador y se recalculan al instante. Las decisiones ya tomadas (presente / ausente) no cambian.</p></div>
    <div className="rubric-summary"><div><span className="eyebrow">TOTAL</span><strong>{total.toLocaleString('es')}</strong><span>puntos + {draft.bonus.points.toLocaleString('es')} extra</span></div><div className="toolbar"><button className="button secondary" onClick={onReset} disabled={isDefaultRubric(rubric)}><RotateCcw size={15} /> Restablecer original</button><button className="button primary" onClick={save}><Save size={15} /> Guardar rúbrica</button></div></div>
    {error && <p className="role-error" role="alert">{error}</p>}
    <div className="rubric-grid">
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">FORMAL</span><h3>Entrega</h3></div><SlidersHorizontal size={18} /></div>
        <Num label="Puntos por sinopsis presente" value={draft.formal.synopsisPoints} onChange={v => set('formal', { synopsisPoints: v })} />
        <Num label="Puntos por nombre de archivo" value={draft.formal.fileNamePoints} onChange={v => set('formal', { fileNamePoints: v })} />
        <NameFormat formal={draft.formal} onChange={fileNamePattern => set('formal', { fileNamePattern })} />
        <Num label="Mínimo de caracteres de la sinopsis" value={draft.formal.minSynopsisChars} step={1} max={5000} onChange={v => set('formal', { minSynopsisChars: Math.round(v) })} />
      </section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">TÉCNICA</span><h3>Medido en el archivo</h3></div></div>
        <Num label="Puntos máximos" value={draft.technical.maxPoints} onChange={v => set('technical', { maxPoints: v })} />
        <label className="field"><span>Frecuencia de muestreo exigida</span><select value={draft.technical.requiredSampleRate ?? ''} onChange={e => set('technical', { requiredSampleRate: e.target.value ? Number(e.target.value) : null })}><option value="">No exigir</option><option value={44100}>44 100 Hz</option><option value={48000}>48 000 Hz</option><option value={96000}>96 000 Hz</option></select></label>
        <Num label="Penalización por frecuencia incorrecta" value={draft.technical.sampleRatePenalty} onChange={v => set('technical', { sampleRatePenalty: v })} />
        <Num label="Penalización por clipping" value={draft.technical.clippingPenalty} onChange={v => set('technical', { clippingPenalty: v })} />
        <fieldset className="tier-list"><legend>Penalización por clics y cortes</legend>{tiers.map((t, i) => <div key={i} className="tier-row"><span>{i === 0 ? 'Hasta' : `De ${(tiers[i - 1].maxClicks ?? 0) + 1} a`}</span>{t.maxClicks === null ? <b>sin límite</b> : <input type="number" min={0} step={1} aria-label={`Máximo de clics del tramo ${i + 1}`} value={t.maxClicks} onChange={e => set('technical', { clickTiers: tiers.map((x, j) => j === i ? { ...x, maxClicks: Math.max(0, Math.round(Number(e.target.value))) } : x) })} />}<span>clics →</span><input type="number" min={0} step={0.5} aria-label={`Penalización del tramo ${i + 1}`} value={t.penalty} onChange={e => set('technical', { clickTiers: tiers.map((x, j) => j === i ? { ...x, penalty: Number(e.target.value) } : x) })} /><span>pts</span></div>)}</fieldset>
        <label className="field checkbox-field"><input type="checkbox" checked={!!draft.technical.duration} onChange={e => set('technical', { duration: e.target.checked ? { minSec: 55, maxSec: 65, penalty: 1 } : null })} /> Exigir una duración</label>
        {draft.technical.duration && <div className="two-fields"><Num label="Mínimo (s)" value={draft.technical.duration.minSec} step={1} max={86400} onChange={v => set('technical', { duration: { ...draft.technical.duration!, minSec: v } })} /><Num label="Máximo (s)" value={draft.technical.duration.maxSec} step={1} max={86400} onChange={v => set('technical', { duration: { ...draft.technical.duration!, maxSec: v } })} /><Num label="Penalización" value={draft.technical.duration.penalty} onChange={v => set('technical', { duration: { ...draft.technical.duration!, penalty: v } })} /></div>}
      </section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">CREATIVIDAD</span><h3>Herramientas</h3></div></div>
        <Num label="Puntos máximos" value={draft.creative.maxPoints} onChange={v => set('creative', { maxPoints: v })} />
        <fieldset className="tool-list"><legend>Herramientas obligatorias</legend>{EFFECTS.map(e => <label key={e.id} className="checkbox-field"><input type="checkbox" checked={draft.creative.requiredTools.includes(e.id)} onChange={() => toggleTool(e.id)} /> {e.label}</label>)}</fieldset>
        <Num label="Penalización por herramienta obligatoria ausente" value={draft.creative.missingToolPenalty} onChange={v => set('creative', { missingToolPenalty: v })} />
        <div className="two-fields"><Num label="Sobreprocesamiento leve" value={draft.creative.overprocessingPenalty.Leve} onChange={v => set('creative', { overprocessingPenalty: { ...draft.creative.overprocessingPenalty, Leve: v } })} /><Num label="Moderado" value={draft.creative.overprocessingPenalty.Moderado} onChange={v => set('creative', { overprocessingPenalty: { ...draft.creative.overprocessingPenalty, Moderado: v } })} /><Num label="Severo" value={draft.creative.overprocessingPenalty.Severo} onChange={v => set('creative', { overprocessingPenalty: { ...draft.creative.overprocessingPenalty, Severo: v } })} /></div>
      </section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">EXTRA</span><h3>Bonificación</h3></div></div>
        <Num label="Puntos extra por efectos adicionales" value={draft.bonus.points} onChange={v => set('bonus', { points: v })} hint="Se suman al total cuando el profesor confirma delay, reverb, modulación o generadores." />
        <Num label="Confianza mínima de la IA para contar una detección" value={draft.creative.toolMinConfidence} step={0.05} max={1} onChange={v => set('creative', { toolMinConfidence: v })} hint="Solo afecta a la segunda opinión externa, nunca a tus etiquetas." />
      </section>
    </div>
  </div>;
}
