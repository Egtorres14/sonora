/**
 * Extrae el primer objeto JSON de una respuesta de texto (modelos sin `response_format`):
 * quita vallas ```json, ignora el razonamiento previo y equilibra llaves respetando cadenas.
 */
export const extractJson = (text: string): unknown => {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('La respuesta no contiene JSON.');
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)); }
  }
  throw new Error('El JSON de la respuesta está incompleto.');
};
