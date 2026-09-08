/**
 * Borrador de feedback sin modelos externos: se redacta a partir de lo que ya está decidido
 * (mediciones del archivo, etiquetas y evidencias del profesor, rúbrica). Es determinista y
 * no inventa nada: cada frase remite a un dato o a una anotación del profesor.
 * El profesor lo edita antes de publicarlo. Alternativas más ambiciosas en docs/FEEDBACK-LOCAL.md.
 */
import { calculateReview, EFFECTS, type ReviewRecord } from './review';
import { DEFAULT_RUBRIC, type RubricConfig } from './scoring/rubric';
import { buildEvidence, fmtRange, type EvidenceItem } from './evidence';

const fmtTimes = (items: EvidenceItem[], max = 3) => items.filter((i) => i.time !== undefined).slice(0, max).map((i) => fmtRange({ start: i.time!, end: i.end }).replace(/\.000/g, '')).join(', ');
const num = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 2 });

export interface FeedbackDraft { text: string; strengths: string[]; improvements: string[]; pending: string[] }

export const draftFeedback = (record: ReviewRecord, rubric: RubricConfig = DEFAULT_RUBRIC): FeedbackDraft => {
  const score = calculateReview(record, rubric);
  const evidence = buildEvidence(record, rubric);
  const f = record.features;
  const strengths: string[] = [], improvements: string[] = [], pending: string[] = [];

  // --- Formal ---
  if (score.formal.total >= score.formalMax && score.formalMax > 0) strengths.push('La entrega cumple lo formal: nombre de archivo y sinopsis en regla.');
  else {
    if (!record.synopsis.trim()) improvements.push('Falta la sinopsis: cuenta en unas líneas qué querías conseguir y qué procesos usaste.');
    const nameLine = score.formal.lines.find((l) => l.criterio.toLowerCase().includes('nombre'));
    if (nameLine && nameLine.puntos < (rubric.formal.fileNamePoints ?? 0)) improvements.push(`El nombre del archivo no sigue el formato pedido (${nameLine.detalle.toLowerCase()}).`);
  }

  // --- Técnica ---
  const clip = evidence.filter((i) => i.id.startsWith('clip-'));
  const clicks = evidence.filter((i) => i.id.startsWith('click-'));
  if (f.clipping.detected) improvements.push(`Hay saturación (${f.clipping.runCount} rachas, pico real ${num(f.levels.truePeakDbtp)} dBTP)${clip.length ? ` en ${fmtTimes(clip)}` : ''}: baja la ganancia antes del exportado o usa un limitador con margen.`);
  else if (f.levels.truePeakDbtp > -1) improvements.push(`El pico real llega a ${num(f.levels.truePeakDbtp)} dBTP; deja al menos 1 dB de margen para evitar distorsión al convertir a MP3.`);
  else strengths.push(`Buen control de nivel: pico real ${num(f.levels.truePeakDbtp)} dBTP sin saturación.`);
  if (f.clicks.count > 0) improvements.push(`Se detectan ${f.clicks.count} clics o cortes secos${clicks.length ? ` (${fmtTimes(clicks)})` : ''}: revisa los puntos de corte y añade fundidos de unos milisegundos.`);
  else strengths.push('Los cortes están limpios: no aparecen clics ni discontinuidades.');
  if (Number.isFinite(f.levels.integratedLufs)) {
    const lufs = f.levels.integratedLufs;
    if (lufs < -24) improvements.push(`El nivel general es bajo (${num(lufs)} LUFS integrados); sube la mezcla o normaliza hacia −16/−18 LUFS.`);
    else if (lufs > -10) improvements.push(`El nivel general es muy alto (${num(lufs)} LUFS integrados); una mezcla tan comprimida pierde dinámica.`);
  }
  const gaps = evidence.filter((i) => i.id.startsWith('gap-'));
  if (gaps.length) improvements.push(`Hay silencios internos (${fmtTimes(gaps)}); si no son intencionados, recorta o rellena esos tramos.`);
  const sr = score.technical.lines.find((l) => l.criterio === 'Frecuencia de muestreo');
  if (sr && sr.puntos < 0) improvements.push(`Formato: ${sr.detalle.toLowerCase()}.`);

  // --- Creatividad (solo lo que el profesor ya decidió) ---
  const required = new Set(rubric.creative.requiredTools);
  for (const effect of EFFECTS) {
    const label = record.labels[effect.id];
    const note = record.evidence[effect.id]?.trim();
    if (label === 'present') strengths.push(`${effect.label}: bien resuelto${note ? ` (${note})` : ''}.`);
    else if (label === 'absent' && required.has(effect.id)) improvements.push(`No se aprecia ${effect.label.toLowerCase()}${note ? ` (${note})` : ''}; la rúbrica lo pide, así que conviene incluirlo de forma reconocible.`);
    else if (label === 'unknown' && required.has(effect.id)) pending.push(effect.label);
  }
  if (record.overprocessing === 'Leve' || record.overprocessing === 'Moderado' || record.overprocessing === 'Severo') improvements.push(`Sobreprocesamiento ${record.overprocessing.toLowerCase()}: los efectos tapan la fuente; dosifícalos para que se siga reconociendo el material original.`);
  if (record.overprocessing === 'unknown') pending.push('sobreprocesamiento');
  if (record.extra === 'present') strengths.push(`Efectos extra bien integrados (+${num(rubric.bonus.points)}).`);
  if (record.extra === 'unknown') pending.push('efectos extra');

  // --- Redacción ---
  const who = record.student?.name?.trim().split(/\s+/)[0];
  const lines: string[] = [];
  lines.push(who ? `Hola, ${who}.` : 'Hola.');
  if (strengths.length) lines.push(`Lo que funciona: ${strengths.join(' ')}`);
  if (improvements.length) lines.push(`Para mejorar: ${improvements.join(' ')}`);
  if (score.final !== null) lines.push(`Nota: ${num(score.final)} / ${num(score.maxTotal)}${score.manual ? ' (ajustada por el profesor)' : ''}.`);
  else if (pending.length) lines.push(`Quedan por revisar: ${pending.join(', ')}. La nota se cerrará al completar la revisión.`);
  return { text: lines.join('\n\n'), strengths, improvements, pending };
};
