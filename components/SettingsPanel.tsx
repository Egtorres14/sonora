import React, { useMemo, useState } from 'react';
import { MODEL_CATALOG, PROVIDER_LABELS, estimateCost, findModel, modelsFor } from '../services/llm/catalog';
import { PROVIDERS } from '../services/llm';
import type { ModelInfo, ProviderId } from '../services/llm/types';
import type { LLMSettings } from '../services/settings';

interface SettingsPanelProps {
  settings: LLMSettings;
  onSettingsChange: (s: LLMSettings) => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  durationSec: number;
}

const TAG_STYLE: Record<NonNullable<ModelInfo['tag']>, string> = {
  recomendado: 'bg-brand-secondary/20 text-brand-secondary',
  'mejor-calidad': 'bg-brand-primary/30 text-purple-200',
  'mas-barato': 'bg-emerald-900/50 text-emerald-300',
  legado: 'bg-zinc-700/60 text-zinc-300',
  preview: 'bg-amber-900/50 text-amber-300',
};
const TAG_LABEL: Record<NonNullable<ModelInfo['tag']>, string> = {
  recomendado: 'Recomendado', 'mejor-calidad': 'Mejor calidad', 'mas-barato': 'Más barato', legado: 'Legado', preview: 'Preview',
};

const providerHint: Record<ProviderId, string> = {
  gemini: 'Escucha el audio (mono, 16 kHz) y ve el espectrograma. Mejor relación calidad/precio para "escuchar y juzgar".',
  openai: 'Escucha el audio con los modelos gpt-audio-*. No acepta imágenes, así que no recibe el espectrograma. Coste por minuto de audio más alto.',
  anthropic: 'No escucha audio: razona sobre el espectrograma, la forma de onda y las métricas medidas. Muy bueno redactando feedback y razonando sobre los datos.',
};

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onSettingsChange, apiKey, onApiKeyChange, durationSec }) => {
  const [showKey, setShowKey] = useState(false);
  const models = useMemo(() => modelsFor(settings.provider), [settings.provider]);
  const model = findModel(settings.model) ?? models[0];
  const cost = useMemo(() => estimateCost(model, { audioSec: durationSec, runs: settings.runs, imagePixels: model.inputs.image ? [{ width: 1400, height: 560 }] : [] }), [model, durationSec, settings.runs]);

  const setProvider = (provider: ProviderId) => {
    const first = modelsFor(provider).find((m) => m.tag === 'recomendado') ?? modelsFor(provider)[0];
    onSettingsChange({ ...settings, provider, model: first.id });
  };

  return (
    <div className="text-left space-y-5">
      <div>
        <p className="text-sm font-medium text-brand-text-secondary mb-2">Proveedor de IA</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Proveedor">
          {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((p) => (
            <button
              key={p} type="button" role="radio" aria-checked={settings.provider === p}
              onClick={() => setProvider(p)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${settings.provider === p ? 'border-brand-primary bg-brand-primary/20 text-white' : 'border-brand-border bg-brand-bg text-brand-text-secondary hover:border-brand-text-secondary'}`}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="text-xs text-brand-text-secondary mt-2">{providerHint[settings.provider]}</p>
      </div>

      <div>
        <p className="text-sm font-medium text-brand-text-secondary mb-2">Modelo</p>
        <div className="space-y-2" role="radiogroup" aria-label="Modelo">
          {models.map((m) => {
            const c = estimateCost(m, { audioSec: durationSec, runs: 1, imagePixels: m.inputs.image ? [{ width: 1400, height: 560 }] : [] });
            const active = m.id === model.id;
            return (
              <button
                key={m.id} type="button" role="radio" aria-checked={active}
                onClick={() => onSettingsChange({ ...settings, model: m.id })}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${active ? 'border-brand-primary bg-brand-primary/10' : 'border-brand-border bg-brand-bg hover:border-brand-text-secondary'}`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-brand-text">{m.label}</span>
                  <span className="flex items-center gap-2 text-xs">
                    {m.tag && <span className={`px-2 py-0.5 rounded-full ${TAG_STYLE[m.tag]}`}>{TAG_LABEL[m.tag]}</span>}
                    <span className="text-brand-text-secondary" title="Coste estimado por evaluación (una ejecución)">≈ ${c.perRunUsd.toFixed(3)} / eval</span>
                  </span>
                </div>
                <div className="text-xs text-brand-text-secondary mt-1 flex flex-wrap gap-x-3">
                  <span>{m.inputs.audio ? '🎧 escucha audio' : '🚫 sin audio'}</span>
                  <span>{m.inputs.image ? '🖼️ ve el espectrograma' : '— sin imagen'}</span>
                  <span className="font-mono">{m.id}</span>
                </div>
                {m.notes && <p className="text-xs text-brand-text-secondary/80 mt-1">{m.notes}{m.pricing.note ? ` ${m.pricing.note}` : ''}</p>}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="api-key" className="block text-sm font-medium text-brand-text-secondary mb-2">Clave de API de {PROVIDER_LABELS[settings.provider]}</label>
        <div className="flex gap-2">
          <input
            id="api-key" type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false}
            value={apiKey} onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={settings.provider === 'gemini' ? 'AIza…' : settings.provider === 'openai' ? 'sk-…' : 'sk-ant-…'}
            className="flex-1 p-2.5 text-sm font-mono text-brand-text bg-brand-bg rounded-lg border border-brand-border focus:ring-brand-primary focus:border-brand-primary"
          />
          <button type="button" onClick={() => setShowKey((v) => !v)} className="px-3 rounded-lg border border-brand-border text-xs text-brand-text-secondary hover:text-white">{showKey ? 'Ocultar' : 'Ver'}</button>
        </div>
        <div className="flex items-center justify-between mt-2 gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-brand-text-secondary cursor-pointer">
            <input type="checkbox" checked={settings.rememberKeys} onChange={(e) => onSettingsChange({ ...settings, rememberKeys: e.target.checked })} className="accent-brand-primary" />
            Recordar la clave en este navegador
          </label>
          <span className="text-xs text-brand-text-secondary">{PROVIDERS[settings.provider].keyHelp}</span>
        </div>
        <p className="text-xs text-amber-300/80 mt-2">La clave se usa directamente desde el navegador. No publiques esta app con claves compartidas: para uso en grupo, ponla detrás de un backend.</p>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <label htmlFor="runs" className="block text-sm font-medium text-brand-text-secondary mb-2">Ejecuciones para consenso</label>
          <select id="runs" value={settings.runs} onChange={(e) => onSettingsChange({ ...settings, runs: Number(e.target.value) as 1 | 3 | 5 })} className="p-2 text-sm bg-brand-bg border border-brand-border rounded-lg text-brand-text">
            <option value={1}>1 · una opinión</option>
            <option value={3}>3 · contraste por mayoría</option>
            <option value={5}>5 · contraste por mayoría</option>
          </select>
          <p className="text-xs text-brand-text-secondary mt-1">Cada ejecución es una llamada independiente; las detecciones se deciden por mayoría y se muestra el grado de acuerdo.</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-brand-text-secondary">Coste estimado</p>
          <p className="text-2xl font-bold text-brand-text">${cost.usd.toFixed(3)}</p>
          <p className="text-xs text-brand-text-secondary">{settings.runs} × ${cost.perRunUsd.toFixed(3)} · {Math.round(durationSec)} s de audio</p>
        </div>
      </div>
      <p className="text-xs text-brand-text-secondary/70">Catálogo: {MODEL_CATALOG.length} modelos, precios orientativos. Comprueba la tarifa vigente del proveedor.</p>
    </div>
  );
};

export default SettingsPanel;
