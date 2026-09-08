import { useRef, useState } from 'react';
import { Check, KeyRound, LoaderCircle, Save, Trash2 } from 'lucide-react';
import { ENGINE_INFO, engineCost, loadKey, saveKey, type EngineId, type EngineSettings } from '../../services/engines';
import { modelsFor, findModel, PROVIDER_LABELS } from '../../services/llm/catalog';
import type { ProviderId } from '../../services/llm/types';
import { testKey } from '../../services/llm/keycheck';

interface Props { settings: EngineSettings; onSave: (s: EngineSettings) => void; submissions: number }
const PROVIDERS: ProviderId[] = ['gemini', 'anthropic', 'openai'];
const KEY_HELP: Record<ProviderId, string> = { gemini: 'aistudio.google.com/apikey', openai: 'platform.openai.com/api-keys', anthropic: 'console.anthropic.com/settings/keys' };

export default function EnginesView({ settings, onSave, submissions }: Props) {
  const [draft, setDraft] = useState<EngineSettings>(settings);
  const [keys, setKeys] = useState<Record<ProviderId, string>>({ gemini: loadKey('gemini'), openai: loadKey('openai'), anthropic: loadKey('anthropic') });
  const [show, setShow] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [checking, setChecking] = useState<Partial<Record<ProviderId, boolean>>>({});
  const abort = useRef<AbortController | null>(null);
  const perEval = engineCost(draft, 60, draft.runs);
  const perStudent = engineCost(draft, 60, 1);

  const check = async (p: ProviderId) => {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setChecking((c) => ({ ...c, [p]: true }));
    const result = await testKey(p, keys[p], controller.signal);
    if (!controller.signal.aborted) {
      setDraft((d) => ({ ...d, keyStatus: { ...d.keyStatus, [p]: { ok: result.ok, message: result.message, checkedAt: new Date().toISOString() } } }));
      setChecking((c) => ({ ...c, [p]: false }));
    }
  };
  const setKey = (p: ProviderId, value: string) => { setKeys((k) => ({ ...k, [p]: value })); saveKey(p, value); setDraft((d) => { const keyStatus = { ...d.keyStatus }; delete keyStatus[p]; return { ...d, keyStatus }; }); };
  const choose = (engine: EngineId) => setDraft((d) => ({ ...d, engine }));
  const readyToUse = draft.engine === 'local' || !!keys[draft.engine].trim();

  return <div className="engines-view">
    <div className="page-title"><span className="eyebrow">SEGUNDA OPINIÓN</span><h2>Tú eliges quién opina,<br />y cuánto <em>cuesta.</em></h2><p>Las mediciones y tu criterio no cambian. Aquí decides qué ayuda se ofrece, con qué clave y a quién. Ningún motor modifica etiquetas ni notas.</p></div>

    <div className="engine-list" role="radiogroup" aria-label="Motor de segunda opinión">
      {ENGINE_INFO.map((info) => {
        const active = draft.engine === info.id;
        const provider = info.id === 'local' ? null : info.id;
        const model = provider ? findModel(draft.models[provider]) : null;
        const status = provider ? draft.keyStatus[provider] : undefined;
        return <div key={info.id} className={`engine-card ${active ? 'active' : ''}`}>
          <button type="button" role="radio" aria-checked={active} className="engine-choice" onClick={() => choose(info.id)}>
            <span className="radio-dot">{active && <i />}</span>
            <span className="engine-head"><b>{info.label}</b><span className="mono">{info.id === 'local' ? '0,00 $' : model ? `≈ ${engineCost({ ...draft, engine: info.id }, 60, 1).toFixed(3)} $ / eval` : ''}</span></span>
          </button>
          <p className="engine-summary">{info.summary}</p>
          <div className="engine-pros"><div><b>A favor</b>{info.pros}</div><div><b>En contra</b>{info.cons}</div></div>
          {provider && <div className="engine-config">
            <label className="field">Modelo<select value={draft.models[provider]} onChange={(e) => setDraft((d) => ({ ...d, models: { ...d.models, [provider]: e.target.value } }))}>{modelsFor(provider).map((m) => <option key={m.id} value={m.id}>{m.label}{m.tag ? ` · ${m.tag.replace('-', ' ')}` : ''} · ≈ {engineCost({ ...draft, engine: provider, models: { ...draft.models, [provider]: m.id } }, 60, 1).toFixed(3)} $</option>)}</select></label>
            <label className="field">Clave de API de {PROVIDER_LABELS[provider]}
              <div className="key-row">
                <input type={show[provider] ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={keys[provider]} placeholder={provider === 'gemini' ? 'AIza…' : provider === 'openai' ? 'sk-…' : 'sk-ant-…'} aria-label={`Clave de API de ${PROVIDER_LABELS[provider]}`} onChange={(e) => setKey(provider, e.target.value)} />
                <button type="button" className="button secondary" onClick={() => setShow((s) => ({ ...s, [provider]: !s[provider] }))}>{show[provider] ? 'Ocultar' : 'Ver'}</button>
                <button type="button" className="button secondary" disabled={!keys[provider].trim() || checking[provider]} onClick={() => check(provider)}>{checking[provider] ? <LoaderCircle className="spin" size={14} /> : <KeyRound size={14} />} Probar</button>
                {keys[provider] && <button type="button" className="icon-button" aria-label={`Borrar clave de ${PROVIDER_LABELS[provider]}`} onClick={() => setKey(provider, '')}><Trash2 size={14} /></button>}
              </div>
              <small>Crea la clave en {KEY_HELP[provider]}. {keys[provider].trim() ? 'Guardada en este navegador; se usará en cada consulta.' : 'Se guarda solo en este navegador.'}</small>
            </label>
            {status && <p className={`key-status ${status.ok ? 'ok' : 'bad'}`} role="status">{status.ok ? <Check size={13} /> : null}{status.message} · comprobada {new Date(status.checkedAt).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}</p>}
          </div>}
        </div>;
      })}
    </div>

    <section className="panel engine-access">
      <div className="panel-heading"><div><span className="eyebrow">QUIÉN PUEDE PEDIRLA</span><h3>Uso y presupuesto.</h3></div></div>
      <div className="access-row"><div><b>Yo, al revisar</b><small>Siempre disponible con el motor elegido, desde «Ver asistentes».</small></div><span className="pill positive">Activo</span></div>
      <div className="access-row"><div><b>Los estudiantes, al entregar</b><small>Reciben una lectura orientativa (qué se oye, fortalezas y mejoras), sin nota. Una consulta por entrega, con tu clave y tu presupuesto.</small></div><label className="switch"><input type="checkbox" checked={draft.studentAccess} disabled={draft.engine === 'local'} onChange={(e) => setDraft((d) => ({ ...d, studentAccess: e.target.checked }))} /><span aria-hidden="true" /><span className="visually-hidden">Permitir a los estudiantes pedir una lectura orientativa</span></label></div>
      {draft.engine === 'local' && <p className="muted text-small">Con el modelo local los estudiantes ven las mediciones, pero no una lectura del modelo: sus sugerencias solo aparecen al profesor para no confundir una predicción débil con una corrección.</p>}
      <div className="access-row"><div><b>Ejecuciones por consulta del profesor</b><small>Con 3 o 5 se decide por mayoría y se muestra el acuerdo. Cada ejecución se cobra.</small></div><select aria-label="Ejecuciones por consulta" value={draft.runs} disabled={draft.engine === 'local'} onChange={(e) => setDraft((d) => ({ ...d, runs: Number(e.target.value) as 1 | 3 | 5 }))}><option value={1}>1</option><option value={3}>3</option><option value={5}>5</option></select></div>
      <dl className="cost-summary">
        <div><dt>Por consulta del profesor (60 s, {draft.runs} ejecución{draft.runs > 1 ? 'es' : ''})</dt><dd className="mono">{perEval.toFixed(3)} $</dd></div>
        <div><dt>Por lectura de estudiante</dt><dd className="mono">{draft.studentAccess ? `${perStudent.toFixed(3)} $` : '—'}</dd></div>
        <div><dt>Estimación para {submissions || 120} entregas (1 lectura + 1 revisión)</dt><dd className="mono">{((perEval + (draft.studentAccess ? perStudent : 0)) * (submissions || 120)).toFixed(2)} $</dd></div>
      </dl>
    </section>

    <div className="toolbar engine-actions">
      {!readyToUse && <span className="muted text-small">Introduce y prueba la clave del motor elegido para poder usarlo.</span>}
      <button type="button" className="button primary" onClick={() => onSave(draft)}><Save size={15} /> Guardar motores</button>
    </div>
  </div>;
}
