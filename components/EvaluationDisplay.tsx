import React from 'react';
import type { AudioEvaluation, UsedTool, AudioFeatures, ScoreLine } from '../types';
import RatingCircle from './RatingCircle';
import AudioPlayer from './AudioPlayer';
import EditableField from './EditableField';
import { DEFAULT_RUBRIC } from '../services/scoring/rubric';
import { formatTimestamp } from '../services/audio/features';

interface EvaluationDisplayProps {
  evaluation: AudioEvaluation;
  audioUrl: string;
  onEvaluationChange: (path: (string | number)[], value: unknown) => void;
  features: AudioFeatures;
}

const Card: React.FC<{ title: string; children: React.ReactNode; className?: string; aside?: React.ReactNode }> = ({ title, children, className, aside }) => (
  <div className={`bg-brand-surface border border-brand-border rounded-xl shadow-lg p-6 ${className ?? ''}`}>
    <div className="flex items-start justify-between gap-3 mb-4">
      <h3 className="text-xl font-bold text-brand-primary">{title}</h3>
      {aside}
    </div>
    {children}
  </div>
);

const InfoRow: React.FC<{ label: string; value: React.ReactNode; warn?: boolean }> = ({ label, value, warn }) => (
  <div className="flex justify-between items-start py-2 border-b border-brand-border last:border-b-0 gap-3">
    <dt className="text-sm font-medium text-brand-text-secondary w-2/5">{label}</dt>
    <dd className={`text-sm mt-0 text-right w-3/5 ${warn ? 'text-amber-300 font-semibold' : 'text-brand-text'}`}>{value}</dd>
  </div>
);

const Confidence: React.FC<{ value: number; label?: string }> = ({ value, label }) => {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = pct >= 75 ? 'bg-brand-secondary' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2" title={`Confianza ${pct} %`}>
      <div className="h-1.5 w-20 rounded-full bg-brand-border overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
      <span className="text-xs text-brand-text-secondary">{label ?? `${pct} %`}</span>
    </div>
  );
};

const Breakdown: React.FC<{ lines: ScoreLine[] }> = ({ lines }) => (
  <ul className="space-y-1.5 text-xs">
    {lines.map((l, i) => (
      <li key={i} className="flex gap-3">
        <span className={`font-mono w-14 shrink-0 text-right ${l.puntos < 0 ? 'text-red-300' : l.puntos > 0 ? 'text-brand-secondary' : 'text-brand-text-secondary'}`}>{l.puntos > 0 ? '+' : ''}{l.puntos.toFixed(1)}</span>
        <span className="text-brand-text-secondary"><span className="text-brand-text font-medium">{l.criterio}</span> · {l.detalle} <span className="opacity-60">[{l.fuente}]</span></span>
      </li>
    ))}
  </ul>
);

const ToolCard: React.FC<{ tool: UsedTool; onChange: (path: (string | number)[], value: unknown) => void; basePath: (string | number)[]; required: boolean }> = ({ tool, onChange, basePath, required }) => (
  <div className={`bg-[#2a2a2a] p-4 rounded-lg border flex flex-col gap-2 ${tool.detectado ? 'border-brand-secondary/40' : required ? 'border-red-400/40' : 'border-brand-border'}`}>
    <div className="flex items-center justify-between gap-2">
      <h4 className="font-semibold capitalize text-brand-text">{tool.herramienta.replace('_', ' ')}</h4>
      <label className="flex items-center gap-1 text-xs text-brand-text-secondary cursor-pointer" title="Corrige la detección del modelo">
        <input type="checkbox" checked={tool.detectado} onChange={(e) => onChange([...basePath, 'detectado'], e.target.checked)} className="accent-brand-secondary" />
        {tool.detectado ? 'usada' : 'no usada'}
      </label>
    </div>
    <Confidence value={tool.confianza} />
    <div className="text-xs text-brand-text-secondary">Calidad: <span className="text-brand-text">{tool.calidad_de_uso}</span>{!required && <span className="ml-2 opacity-60">(opcional)</span>}</div>
    <div className="text-xs flex-grow">
      <EditableField value={tool.comentarios} onSave={(v) => onChange([...basePath, 'comentarios'], v)} type="textarea" className="text-xs text-brand-text-secondary italic" placeholder="Sin evidencia…" />
    </div>
  </div>
);

const EvaluationDisplay: React.FC<EvaluationDisplayProps> = ({ evaluation, audioUrl, onEvaluationChange, features }) => {
  const { nombre_archivo, evaluacion_rubrica, evaluacion_tecnica, evaluacion_creatividad_y_procesamiento: creat, puntos_extra, resumen_y_calificacion_final: final, meta } = evaluation;
  const f = features;
  const required = new Set<string>(DEFAULT_RUBRIC.creative.requiredTools);
  const agreementPct = meta.agreement === null ? 'sin contraste' : Math.round(meta.agreement * 100);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-white">Resultados de la evaluación</h2>
        <p className="text-brand-text-secondary mt-1 font-mono">{nombre_archivo}</p>
        <p className="text-xs text-brand-text-secondary mt-1">
          {meta.providerLabel} · {meta.modelLabel} · entrada: {meta.modalidad} · {meta.runs} ejecución(es) · acuerdo {agreementPct} % · ≈ ${meta.estimatedCostUsd.toFixed(4)} · {(meta.elapsedMs / 1000).toFixed(1)} s
        </p>
      </div>

      <Card title="Reproductor con marcadores">
        <AudioPlayer src={audioUrl} features={f} />
      </Card>

      <Card title="Resumen y calificación final">
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="flex flex-col items-center">
            <RatingCircle score={(final.calificacion_final / final.calificacion_maxima) * 10} />
            <EditableField value={final.calificacion_final} onSave={(v) => onEvaluationChange(['resumen_y_calificacion_final', 'calificacion_final'], v)} type="number" className="text-2xl font-bold text-brand-text mt-2" suffix={` / ${final.calificacion_maxima}`} />
            <p className="text-xs text-brand-text-secondary mt-1">formal {(evaluacion_rubrica.presencia_sinopsis.puntos_obtenidos + evaluacion_rubrica.nombre_y_sinopsis.puntos_obtenidos).toFixed(1)} · técnica {evaluacion_tecnica.calificacion_tecnica.toFixed(1)} · creatividad {creat.calificacion_creatividad.toFixed(1)} · extra {puntos_extra.puntos.toFixed(1)}</p>
          </div>
          <div className="flex-1 space-y-3 w-full">
            <EditableField value={final.comentarios_generales} onSave={(v) => onEvaluationChange(['resumen_y_calificacion_final', 'comentarios_generales'], v)} type="textarea" className="text-brand-text-secondary" placeholder="Sin comentarios generales…" />
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-brand-bg/50 rounded-lg border border-brand-secondary/30">
                <p className="font-semibold text-brand-secondary mb-1">Fortalezas</p>
                <ul className="list-disc pl-4 text-brand-text-secondary space-y-1 text-xs">{final.fortalezas.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
              <div className="p-3 bg-brand-bg/50 rounded-lg border border-amber-500/30">
                <p className="font-semibold text-amber-300 mb-1">Mejoras</p>
                <ul className="list-disc pl-4 text-brand-text-secondary space-y-1 text-xs">{final.mejoras.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            </div>
            <div className="p-3 bg-brand-bg/50 rounded-lg border border-brand-border">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <EditableField value={puntos_extra.puntos} onSave={(v) => onEvaluationChange(['puntos_extra', 'puntos'], v)} type="number" className="font-bold text-brand-secondary text-sm" prefix="Puntos extra: " />
                <Confidence value={puntos_extra.confianza} label={puntos_extra.cuales.length ? puntos_extra.cuales.join(', ') : `${Math.round(puntos_extra.confianza * 100)} %`} />
              </div>
              <EditableField value={puntos_extra.comentarios} onSave={(v) => onEvaluationChange(['puntos_extra', 'comentarios'], v)} type="textarea" className="text-brand-text-secondary italic text-sm" placeholder="Sin comentarios de puntos extra…" />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Evaluación técnica" aside={<span className="text-xs rounded-full px-2 py-0.5 bg-brand-bg border border-brand-border text-brand-text-secondary">medida en el navegador</span>}>
          <div className="flex justify-between items-center mb-4">
            <span className="text-brand-text-secondary">Calificación</span>
            <EditableField value={evaluacion_tecnica.calificacion_tecnica} onSave={(v) => onEvaluationChange(['evaluacion_tecnica', 'calificacion_tecnica'], v)} type="number" className="text-xl font-bold text-brand-text" suffix={` / ${evaluacion_tecnica.calificacion_maxima}`} />
          </div>
          <Breakdown lines={evaluacion_tecnica.desglose} />
          <dl className="space-y-1 text-sm mt-4">
            <InfoRow label="Formato" value={`${f.format.sampleRate} Hz · ${f.format.bitDepth || '?'} bit ${f.format.sampleFormat} · ${f.format.channels} ch`} />
            <InfoRow label="Sonoridad integrada" value={Number.isFinite(f.levels.integratedLufs) ? `${f.levels.integratedLufs} LUFS · LRA ${f.levels.loudnessRangeLu} LU` : '−∞ LUFS'} />
            <InfoRow label="Pico" value={`${f.levels.truePeakDbtp} dBTP (muestra ${f.levels.samplePeakDbfs} dBFS)`} warn={f.clipping.interSampleOvers} />
            <InfoRow label="Clipping" value={f.clipping.detected ? `${f.clipping.runCount} rachas · ${f.clipping.clippedSamples} muestras` : 'no'} warn={f.clipping.detected} />
            <InfoRow label="Clics / cortes" value={f.clicks.events.length ? f.clicks.events.slice(0, 8).map((e) => formatTimestamp(e.time)).join(', ') + (f.clicks.events.length > 8 ? '…' : '') : 'ninguno'} warn={f.clicks.events.length > 0} />
            <InfoRow label="Silencio" value={`inicio ${f.silence.leadingSec} s · final ${f.silence.trailingSec} s · huecos ${f.silence.gaps.length}`} />
            {f.stereo && <InfoRow label="Estéreo" value={`corr. ${f.stereo.correlation} · balance ${f.stereo.balanceDb} dB${f.stereo.isDualMono ? ' · dual mono' : ''}`} warn={f.stereo.correlation < 0 || f.stereo.isDualMono} />}
            <InfoRow label="Espectro" value={`centroide ${f.spectrum.centroidHz} Hz · ancho de banda ${f.spectrum.bandwidthHz} Hz`} warn={!f.heuristics.contentAbove16k} />
          </dl>
          <dt className="text-sm font-medium text-brand-text-secondary pt-4">Comentarios (editables)</dt>
          <dd className="text-xs text-brand-text-secondary pt-1 pl-2 space-y-2">
            <EditableField value={evaluacion_tecnica.presencia_de_artefactos.distorsion_digital.comentarios} onSave={(v) => onEvaluationChange(['evaluacion_tecnica', 'presencia_de_artefactos', 'distorsion_digital', 'comentarios'], v)} type="textarea" className="italic" placeholder="Sin comentarios sobre distorsión…" />
            <EditableField value={evaluacion_tecnica.presencia_de_artefactos.clics_y_pops.comentarios} onSave={(v) => onEvaluationChange(['evaluacion_tecnica', 'presencia_de_artefactos', 'clics_y_pops', 'comentarios'], v)} type="textarea" className="italic" placeholder="Sin comentarios sobre clics…" />
            <EditableField value={evaluacion_tecnica.presencia_de_artefactos.otros_problemas} onSave={(v) => onEvaluationChange(['evaluacion_tecnica', 'presencia_de_artefactos', 'otros_problemas'], v)} type="textarea" className="italic" placeholder="Sin otros problemas…" />
          </dd>
        </Card>

        <Card title="Creatividad y procesamiento" aside={<span className="text-xs rounded-full px-2 py-0.5 bg-brand-bg border border-brand-border text-brand-text-secondary">juicio del modelo</span>}>
          <div className="flex justify-between items-center mb-4">
            <span className="text-brand-text-secondary">Calificación</span>
            <EditableField value={creat.calificacion_creatividad} onSave={(v) => onEvaluationChange(['evaluacion_creatividad_y_procesamiento', 'calificacion_creatividad'], v)} type="number" className="text-xl font-bold text-brand-text" suffix={` / ${creat.calificacion_maxima}`} />
          </div>
          <Breakdown lines={creat.desglose} />
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="text-sm font-medium text-brand-text-secondary">Qué describe el modelo</p>
              <p className="text-xs text-brand-text-secondary italic mt-1">{creat.descripcion_sonora}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-brand-text-secondary">Coherencia con la sinopsis <span className="font-mono text-brand-text">{creat.coherencia_con_sinopsis.puntuacion.toFixed(1)} / 5</span></p>
              <p className="text-xs text-brand-text-secondary italic mt-1">{creat.coherencia_con_sinopsis.comentarios}</p>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-brand-text-secondary">Sobreprocesamiento: <span className="text-brand-text">{creat.sobreprocesamiento.detectado ? creat.sobreprocesamiento.nivel : 'no'}</span></p>
                <Confidence value={creat.sobreprocesamiento.confianza} />
              </div>
              <EditableField value={creat.sobreprocesamiento.comentarios} onSave={(v) => onEvaluationChange(['evaluacion_creatividad_y_procesamiento', 'sobreprocesamiento', 'comentarios'], v)} type="textarea" className="text-xs italic text-brand-text-secondary" placeholder="Sin comentarios sobre sobreprocesamiento…" />
            </div>
          </div>
        </Card>
      </div>

      <Card title="Herramientas creativas (detección del modelo)" aside={<span className="text-xs text-brand-text-secondary">marca/desmarca para corregir; la nota se recalcula al editar la calificación</span>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {creat.herramientas_utilizadas.map((tool, index) => (
            <ToolCard key={`${tool.herramienta}-${index}`} tool={tool} onChange={onEvaluationChange} basePath={['evaluacion_creatividad_y_procesamiento', 'herramientas_utilizadas', index]} required={required.has(tool.herramienta)} />
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Fiabilidad de esta evaluación">
          <dl className="space-y-1 text-sm">
            <InfoRow label="Acuerdo entre ejecuciones" value={meta.agreement === null ? 'Sin contraste (una ejecución)' : `${agreementPct} % (${meta.runs} ejecuciones)`} warn={meta.agreement !== null && meta.agreement < 0.8} />
            <InfoRow label="Decisiones sin unanimidad" value={meta.disputed.length ? meta.disputed.join(', ') : 'ninguna'} warn={meta.disputed.length > 0} />
            <InfoRow label="Lo que recibió el modelo" value={meta.modalidad} />
            <InfoRow label="Tokens" value={`${meta.usage.inputTokens} entrada${meta.usage.audioTokens ? ` (${meta.usage.audioTokens} audio)` : ''} · ${meta.usage.outputTokens} salida`} />
            <InfoRow label="Coste" value={`≈ $${meta.estimatedCostUsd.toFixed(4)}`} />
            {meta.failures.length > 0 && <InfoRow label="Ejecuciones fallidas" value={meta.failures.join(' · ')} warn />}
            {meta.warnings.length > 0 && <InfoRow label="Avisos" value={meta.warnings.join(' · ')} warn />}
          </dl>
          <p className="text-xs text-brand-text-secondary mt-3"><span className="font-semibold text-brand-text">Limitaciones declaradas por el modelo:</span> {final.limitaciones}</p>
        </Card>
        <Card title="Criterios aplicados">
          <dl className="space-y-1 text-xs text-brand-text-secondary">
            <div className="flex justify-between"><dt>Sinopsis presente / nombre descriptivo</dt><dd className="font-mono">{DEFAULT_RUBRIC.formal.synopsisPoints} + {DEFAULT_RUBRIC.formal.fileNamePoints} pts</dd></div>
            <div className="flex justify-between"><dt>Frecuencia de muestreo ≠ {DEFAULT_RUBRIC.technical.requiredSampleRate} Hz</dt><dd className="font-mono">−{DEFAULT_RUBRIC.technical.sampleRatePenalty} pts</dd></div>
            <div className="flex justify-between"><dt>Clipping (rachas ≥ 3 muestras a fondo de escala)</dt><dd className="font-mono">−{DEFAULT_RUBRIC.technical.clippingPenalty} pts</dd></div>
            <div className="flex justify-between"><dt>Clics: 1–2 / 3–5 / &gt;5</dt><dd className="font-mono">−1 / −2.5 / −4 pts</dd></div>
            {DEFAULT_RUBRIC.technical.duration && <div className="flex justify-between"><dt>Duración fuera de {DEFAULT_RUBRIC.technical.duration.minSec}–{DEFAULT_RUBRIC.technical.duration.maxSec} s</dt><dd className="font-mono">−{DEFAULT_RUBRIC.technical.duration.penalty} pts</dd></div>}
            <div className="flex justify-between"><dt>Herramienta obligatoria no detectada (confianza ≥ {DEFAULT_RUBRIC.creative.toolMinConfidence})</dt><dd className="font-mono">−{DEFAULT_RUBRIC.creative.missingToolPenalty} pts c/u</dd></div>
            <div className="flex justify-between"><dt>Sobreprocesamiento leve / moderado / severo</dt><dd className="font-mono">−1 / −1.75 / −2.5 pts</dd></div>
            <div className="flex justify-between"><dt>Efectos extra claros</dt><dd className="font-mono">+{DEFAULT_RUBRIC.bonus.points} pts</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
};

export default EvaluationDisplay;
