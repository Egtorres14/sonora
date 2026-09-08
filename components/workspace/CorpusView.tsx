import { useEffect, useMemo, useRef, useState } from 'react';
import { Database, Download, ExternalLink, Headphones, LoaderCircle, Search, ShieldCheck } from 'lucide-react';
import { EFFECTS } from '../../services/review';
import { categoryLabel, corpusCoverage, corpusUrl, describeChainStep, fetchCorpusIndex, fetchCorpusModel, TOOL_IDS, VARIANT_LABEL, type CorpusIndex } from '../../services/corpus';
import type { LocalModel } from '../../services/learning/types';

interface Props {
  /** Ids ya presentes en la biblioteca, para saber si el corpus está importado. */
  libraryIds: Set<string>;
  model: LocalModel | null;
  busy: boolean;
  onImport: (withModel: boolean) => Promise<void>;
}
const pct = (n: number | null) => n === null ? '—' : `${Math.round(n * 100)} %`;
const fmtSec = (s: number) => `${s.toFixed(1)} s`;

export default function CorpusView({ libraryIds, model, busy, onImport }: Props) {
  const [index, setIndex] = useState<CorpusIndex | null>(null);
  const [published, setPublished] = useState<LocalModel | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('todas');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const playing = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchCorpusIndex(controller.signal).then(setIndex).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudo cargar el corpus.'); });
    fetchCorpusModel(controller.signal).then(setPublished).catch(() => { if (!controller.signal.aborted) setPublished(null); });
    return () => controller.abort();
  }, []);

  const coverage = useMemo(() => index ? corpusCoverage(index) : [], [index]);
  const categories = useMemo(() => index ? [...new Set(index.sources.map((s) => s.category))].sort() : [], [index]);
  const imported = index ? index.records.filter((r) => libraryIds.has(r.id)).length : 0;
  const modelLoaded = !!model && !!published && model.trainedAt === published.trainedAt;
  const filtered = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    return index.sources.filter((s) => (category === 'todas' || s.category === category) && (!q || `${s.id} ${s.description} ${s.attribution}`.toLowerCase().includes(q)));
  }, [index, query, category]);

  // Solo un extracto suena a la vez: al reproducir uno se pausa el anterior.
  const onPlay = (e: React.SyntheticEvent<HTMLAudioElement>) => { if (playing.current && playing.current !== e.currentTarget) playing.current.pause(); playing.current = e.currentTarget; };

  return <div className="corpus-view">
    <div className="page-title"><span className="eyebrow">MUESTRAS DE ENTRENAMIENTO</span><h2>Cada proceso,<br />con su <em>etiqueta exacta.</em></h2><p>Grabaciones de dominio público o CC0 procesadas por el generador del proyecto: cada variante sabe qué se le hizo. Escucha los extractos, importa la colección y carga el modelo entrenado con ella.</p></div>

    {error && <div className="alert-banner" role="alert"><div><b>El corpus no está disponible</b><p>{error} Puedes generarlo con <code>npm run corpus:build</code>.</p></div></div>}
    {!index && !error && <div className="empty-table"><LoaderCircle className="spin" size={18} /> Cargando el índice del corpus…</div>}

    {index && <>
      <section className="panel corpus-summary">
        <div className="panel-heading"><div><span className="eyebrow">LO QUE CONTIENE</span><h3>{index.sources.length} grabaciones · {index.records.length} muestras etiquetadas.</h3></div><Database size={22} /></div>
        <div className="learning-counters corpus-counters">
          {coverage.map((c) => <span key={c.tool}><b>{c.present}<small> / {c.absent}</small></b>{EFFECTS.find((e) => e.id === c.tool)?.label}<em>presente / ausente</em></span>)}
        </div>
        <p className="muted text-small">Cada grabación tiene {Math.round(index.records.length / Math.max(1, index.sources.length))} variantes: original, dos por herramienta con ajustes distintos, cuatro combinaciones y tres distractores (reverb, delay, saturación…) que no cuentan como ninguna de las cinco herramientas. Generado el {new Date(index.generatedAt).toLocaleDateString('es')} con recortes de {index.clipSeconds} s.</p>
        <div className="toolbar corpus-actions">
          <button type="button" className="button primary" disabled={busy || imported === index.records.length} onClick={() => void onImport(true)}><Download size={15} /> {imported === index.records.length ? 'Corpus importado' : imported ? `Completar importación (${index.records.length - imported} nuevas)` : 'Importar corpus a la biblioteca'}</button>
          {published && <button type="button" className="button secondary" disabled={busy || modelLoaded} onClick={() => void onImport(true)}>{modelLoaded ? 'Modelo cargado' : 'Cargar modelo entrenado'}</button>}
          <span className="muted text-small">{imported} / {index.records.length} en tu biblioteca{published === null ? ' · sin modelo publicado' : ''}. Se importan mediciones y etiquetas; el audio completo no se guarda.</span>
        </div>
      </section>

      {published && <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">VALIDACIÓN DEL MODELO PUBLICADO</span><h3>Entrenado el {new Date(published.trainedAt).toLocaleDateString('es')} con {published.trainingSampleIds.length} muestras.</h3></div><ShieldCheck size={22} /></div>
        <div className="library-table-wrap"><table className="library-table"><thead><tr><th>Herramienta</th><th>Exactitud equilibrada</th><th>Precisión</th><th>Sensibilidad</th><th>VP / VN / FP / FN</th></tr></thead><tbody>
          {TOOL_IDS.map((t) => { const e = published.effects[t]; return <tr key={t}><td>{EFFECTS.find((f) => f.id === t)?.label}</td><td>{e ? pct(e.validation.balancedAccuracy) : '—'}</td><td>{e ? pct(e.validation.precision) : '—'}</td><td>{e ? pct(e.validation.recall) : '—'}</td><td className="mono">{e ? Object.values(e.validation.confusion).join(' / ') : '—'}</td></tr>; })}
        </tbody></table></div>
        <p className="library-footnote">Validación en tres particiones separadas por grabación de origen: ninguna variante de una grabación se evalúa con un modelo que la haya visto. Mide cuánto se distinguen estos procesos en este corpus, no el rendimiento sobre trabajos de estudiantes.</p>
      </section>}

      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">ESCUCHAR LAS MUESTRAS</span><h3>Original y una versión por herramienta.</h3></div><Headphones size={22} /></div>
        <div className="corpus-filters">
          <label className="search-field"><Search size={14} /><input type="search" placeholder="Buscar grabación o autor…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar en el corpus" /></label>
          <div className="segmented corpus-categories" role="group" aria-label="Categoría"><button type="button" aria-pressed={category === 'todas'} className={category === 'todas' ? 'selected' : ''} onClick={() => setCategory('todas')}>Todas</button>{categories.map((c) => <button key={c} type="button" aria-pressed={category === c} className={category === c ? 'selected' : ''} onClick={() => setCategory(c)}>{categoryLabel(c)}</button>)}</div>
        </div>
        <p className="muted text-small">Extractos de {index.mp3Seconds} s a 16 kHz en MP3, solo para escuchar: las mediciones de la colección se hicieron sobre el WAV completo.</p>
        <div className="corpus-sources">
          {filtered.map((s) => {
            const records = index.records.filter((r) => r.sourceGroup === s.id);
            const listen = records.filter((r) => r.audio);
            const more = open[s.id];
            return <article className="corpus-source" key={s.id}>
              <header><div><span className="pill">{categoryLabel(s.category)}</span><h4>{s.description || s.id}</h4><small>{s.attribution} · {s.license} · {s.sampleRate.toLocaleString('es')} Hz · {fmtSec(s.seconds)} {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer">origen <ExternalLink size={11} /></a>}</small></div></header>
              <div className="corpus-clips">
                {listen.map((r) => <div className="corpus-clip" key={r.id}>
                  <b>{VARIANT_LABEL[r.variant] ?? r.variant}</b>
                  <span>{r.chain.map(describeChainStep).join(' → ')}</span>
                  <audio controls preload="none" src={corpusUrl(r.audio!)} onPlay={onPlay} aria-label={`${VARIANT_LABEL[r.variant] ?? r.variant} de ${s.description || s.id}`} />
                </div>)}
              </div>
              <button type="button" className="text-button" aria-expanded={!!more} onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>{more ? 'Ocultar' : 'Ver'} las {records.length} variantes etiquetadas</button>
              {more && <div className="library-table-wrap"><table className="library-table corpus-table"><thead><tr><th>Variante</th><th>Cadena de procesos</th>{TOOL_IDS.map((t) => <th key={t}>{EFFECTS.find((e) => e.id === t)?.label}</th>)}<th>Duración</th></tr></thead><tbody>
                {records.map((r) => <tr key={r.id} className={libraryIds.has(r.id) ? 'in-library' : ''}><td>{r.variant}</td><td>{r.chain.map(describeChainStep).join(' → ')}</td>{TOOL_IDS.map((t) => <td key={t} className={`corpus-label ${r.labels[t]}`}>{r.labels[t] === 'present' ? 'Sí' : 'No'}</td>)}<td className="mono">{fmtSec(r.seconds)}</td></tr>)}
              </tbody></table></div>}
            </article>;
          })}
          {filtered.length === 0 && <div className="empty-table">Ninguna grabación coincide con el filtro.</div>}
        </div>
      </section>

      <div className="method-note"><ShieldCheck size={20} /><p><b>Etiquetas exactas, no opiniones.</b> El generador aplica cada proceso con DSP propio (phase vocoder, filtros RBJ, inversión, loops) y anota qué hizo y dónde. Por eso sirve para comprobar que el modelo separa los procesos; no sustituye a una colección de trabajos reales verificados por ti. Todo el pipeline está en <code>scripts/corpus/</code>.</p></div>
    </>}
  </div>;
}
