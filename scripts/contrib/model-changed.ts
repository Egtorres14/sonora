/**
 * ¿Merece publicarse el modelo comunitario recién entrenado?
 *
 *   npx tsx scripts/contrib/model-changed.ts anterior.json nuevo.json
 *
 * Código de salida: 0 si hay que publicar (cambió algo, o no había modelo anterior legible),
 * 1 si es el mismo modelo salvo la fecha y la serialización, 2 si el uso es incorrecto.
 * Lo usa .github/workflows/corpus.yml para no commitear un modelo que no ha cambiado.
 */
import fs from 'node:fs';
import { modelsDiffer } from './model-fingerprint';
import type { LocalModel } from '../../services/learning/types';

const [previousPath, nextPath] = process.argv.slice(2);
if (!previousPath || !nextPath || !fs.existsSync(nextPath)) {
  console.error('Uso: model-changed.ts anterior.json nuevo.json (el nuevo tiene que existir).');
  process.exit(2);
}

const read = (file: string): LocalModel | null => {
  try { return fs.statSync(file).size ? JSON.parse(fs.readFileSync(file, 'utf8')) as LocalModel : null; }
  catch { return null; }
};

const previous = fs.existsSync(previousPath) ? read(previousPath) : null;
const next = read(nextPath);
if (!next) { console.error(`No se puede leer el modelo nuevo (${nextPath}).`); process.exit(2); }

if (!previous) { console.log('No había un modelo publicado legible: hay que publicar.'); process.exit(0); }
if (modelsDiffer(previous, next)) { console.log('El modelo cambió: hay que publicarlo.'); process.exit(0); }
console.log('Mismo modelo salvo la fecha y la serialización del bosque: no se publica.');
process.exit(1);
