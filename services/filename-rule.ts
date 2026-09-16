/**
 * Formato de nombre de archivo que exige el profesor.
 *
 * Antes solo se comprobaba que el nombre no estuviera en una lista de nombres genéricos, así que
 * «asdkjh.wav» sacaba los puntos completos. Aquí el profesor escribe la plantilla tal como la
 * pondría en el enunciado («{estudiante}_{estudiante}_ejercicio{numero}») y se compila a una
 * comprobación que, además, verifica que las palabras del nombre son de quien entrega.
 */

/** Campos que entiende la plantilla, para mostrarlos en el editor de la rúbrica. */
export const NAME_FIELDS: { token: string; help: string }[] = [
  { token: '{estudiante}', help: 'Una palabra del nombre con el que entró el estudiante' },
  { token: '{numero}', help: 'Uno o más dígitos' },
  { token: '{texto}', help: 'Una palabra de letras o números' },
  { token: '*', help: 'Cualquier cosa' },
];

export interface NameCheck { ok: boolean; reason: string }
interface CompiledPattern { regex: RegExp; studentSlots: number }

const AUDIO_EXTENSION = /\.(wav|wave|aif|aiff|aifc|flac)$/i;
const TOKENS = /\{estudiante\}|\{numero\}|\{texto\}|\*/g;
/** Partículas que no identifican a nadie: «de_la_ejercicio3» no demuestra de quién es la entrega. */
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'do', 'dos', 'van', 'von']);

/** Sin extensión de audio, sin acentos y en minúsculas, igual para archivos y plantillas. */
const fold = (text: string) => text.trim().replace(AUDIO_EXTENSION, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escapeLiteral = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameWords = (studentName: string) => fold(studentName).split(/[^a-z0-9]+/).filter(w => w.length >= 2 && !PARTICLES.has(w));

/** Compila la plantilla. Devuelve null si está vacía: entonces no hay formato exigido. */
export const compileNamePattern = (template: string): CompiledPattern | null => {
  const folded = fold(template);
  if (!folded) return null;
  let source = '^', last = 0, studentSlots = 0;
  for (const match of folded.matchAll(TOKENS)) {
    source += escapeLiteral(folded.slice(last, match.index));
    if (match[0] === '{estudiante}') { source += '([a-z0-9]+)'; studentSlots++; }
    else if (match[0] === '{numero}') source += '\\d+';
    else if (match[0] === '{texto}') source += '[a-z0-9]+';
    else source += '.*';
    last = (match.index ?? 0) + match[0].length;
  }
  source += `${escapeLiteral(folded.slice(last))}$`;
  // Todo lo que no es un campo se escapa, así que la expresión siempre es válida.
  return { regex: new RegExp(source), studentSlots };
};

/** Un nombre que cumple la plantilla, con las palabras del estudiante si se conocen. */
export const describeNamePattern = (template: string, studentName?: string): string => {
  const words = studentName ? nameWords(studentName) : [];
  const fallback = ['apellido', 'nombre', 'apellido'];
  let slot = 0;
  const example = fold(template)
    .replace(/\{estudiante\}/g, () => { const word = words[slot] ?? fallback[slot % fallback.length]; slot++; return word; })
    .replace(/\{numero\}/g, '3')
    .replace(/\{texto\}/g, 'proyecto')
    .replace(/\*/g, 'extra');
  return example ? `${example}.wav` : '';
};

/**
 * Comprueba un nombre de archivo contra la plantilla. Sin nombre de estudiante (una muestra del
 * propio profesor, o la ruta de la IA, que no lo recibe) se exige la forma pero no se puede
 * verificar de quién es.
 */
export const checkFileName = (fileName: string, template: string, studentName?: string): NameCheck => {
  const compiled = compileNamePattern(template);
  if (!compiled) return { ok: true, reason: 'No hay formato de nombre exigido.' };
  const match = compiled.regex.exec(fold(fileName));
  if (!match) {
    return { ok: false, reason: `«${fileName}» no sigue el formato exigido (${template.trim()}). Un nombre válido sería «${describeNamePattern(template, studentName)}».` };
  }
  if (compiled.studentSlots && studentName?.trim()) {
    const words = nameWords(studentName);
    for (let slot = 1; slot <= compiled.studentSlots; slot++) {
      if (!words.includes(match[slot])) return { ok: false, reason: `«${match[slot]}» no forma parte del nombre registrado (${studentName.trim()}).` };
    }
  }
  return { ok: true, reason: `«${fileName}» sigue el formato exigido.` };
};
