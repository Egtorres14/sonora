/**
 * Integra una contribución enviada como issue (plantilla "Contribuir muestras").
 *
 * 1. Lee el cuerpo del issue y localiza los adjuntos (github.com/user-attachments/files/...).
 * 2. Descarga los .json (o .json.gz): valida con DatasetSchema, descarta ids ya presentes en
 *    corpus/coleccion.json o corpus/contributions/*.json, anota la procedencia en `notes`.
 * 3. Guarda corpus/contributions/issue-<N>.json en la rama contrib/issue-<N> y abre un PR.
 * 4. Los .zip (audio) se suben tal cual a la release "corpus-audio".
 * 5. Comenta en el issue el resultado. Nunca modifica main directamente.
 *
 * Requiere: GH_TOKEN, ISSUE_NUMBER, ISSUE_AUTHOR, REPO (los pone el workflow).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { DatasetSchema } from '../../services/library-schema';

const { GH_TOKEN, ISSUE_NUMBER, ISSUE_AUTHOR = 'desconocido', REPO } = process.env;
if (!GH_TOKEN || !ISSUE_NUMBER || !REPO) throw new Error('Faltan GH_TOKEN, ISSUE_NUMBER o REPO.');

const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN } }).trim();
const comment = (body: string) => gh('issue', 'comment', ISSUE_NUMBER!, '--repo', REPO!, '--body', body);

const main = async () => {
  const issue = JSON.parse(gh('api', `repos/${REPO}/issues/${ISSUE_NUMBER}`));
  const body: string = issue.body ?? '';
  const urls = [...new Set([...body.matchAll(/https:\/\/github\.com\/(?:user-attachments\/files|[^/\s]+\/[^/\s]+\/files)\/[^\s)>"]+/g)].map((m) => m[0]))];
  if (urls.length === 0) { comment('No encontré adjuntos en el issue. Arrastra el `.json` exportado desde Biblioteca (y opcionalmente un `.zip` con audio) al cuerpo del issue y guarda los cambios.'); return; }

  const known = new Set<string>();
  const addKnown = (file: string) => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); for (const r of d.records ?? []) known.add(r.id); } catch { /* ignorar archivos ilegibles */ } };
  if (fs.existsSync('corpus/coleccion.json')) addKnown('corpus/coleccion.json');
  if (fs.existsSync('corpus/contributions')) for (const f of fs.readdirSync('corpus/contributions')) if (f.endsWith('.json')) addKnown(path.join('corpus/contributions', f));

  const accepted: unknown[] = [];
  const report: string[] = [];
  const zips: string[] = [];
  fs.mkdirSync('tmp-contrib', { recursive: true });
  for (const url of urls) {
    const name = decodeURIComponent(url.split('/').pop() ?? 'adjunto');
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${GH_TOKEN}` }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let buf = Buffer.from(await res.arrayBuffer());
      if (name.endsWith('.zip')) { const p = path.join('tmp-contrib', name); fs.writeFileSync(p, buf); zips.push(p); report.push(`- \`${name}\`: audio recibido (${(buf.length / 1e6).toFixed(1)} MB), se sube a la release \`corpus-audio\`.`); continue; }
      if (name.endsWith('.gz')) buf = zlib.gunzipSync(buf);
      if (!name.endsWith('.json') && !name.endsWith('.json.gz')) { report.push(`- \`${name}\`: tipo no admitido (solo .json, .json.gz o .zip).`); continue; }
      const parsed = DatasetSchema.safeParse(JSON.parse(buf.toString('utf8')));
      if (!parsed.success) { report.push(`- \`${name}\`: rechazado, no cumple el esquema (${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}).`); continue; }
      let dup = 0, unknownAll = 0;
      for (const r of parsed.data.records) {
        if (known.has(r.id)) { dup++; continue; }
        const labels = Object.values(r.labels);
        if (labels.every((l) => l === 'unknown')) { unknownAll++; continue; }
        known.add(r.id);
        accepted.push({ ...r, notes: `Contribución issue #${ISSUE_NUMBER} por @${ISSUE_AUTHOR}. ${r.notes ?? ''}`.trim() });
      }
      report.push(`- \`${name}\`: ${parsed.data.records.length} registros; ${parsed.data.records.length - dup - unknownAll} aceptados, ${dup} duplicados, ${unknownAll} sin ninguna etiqueta (omitidos).`);
    } catch (e) {
      report.push(`- \`${name}\`: error al procesar (${(e as Error).message}).`);
    }
  }

  if (zips.length) {
    try { gh('release', 'view', 'corpus-audio', '--repo', REPO!); }
    catch { gh('release', 'create', 'corpus-audio', '--repo', REPO!, '--title', 'Audio de contribuciones', '--notes', 'Audio adjuntado en issues de contribución. Cada archivo se corresponde con un issue.'); }
    for (const z of zips) {
      const renamed = path.join('tmp-contrib', `issue-${ISSUE_NUMBER}-${path.basename(z)}`);
      fs.renameSync(z, renamed);
      gh('release', 'upload', 'corpus-audio', renamed, '--repo', REPO!, '--clobber');
    }
  }

  if (accepted.length === 0) { comment(`Revisé los adjuntos pero no hay registros nuevos que integrar.\n\n${report.join('\n')}`); return; }

  const branch = `contrib/issue-${ISSUE_NUMBER}`;
  const out = path.join('corpus/contributions', `issue-${ISSUE_NUMBER}.json`);
  fs.mkdirSync('corpus/contributions', { recursive: true });
  const jsonSafe = (_k: string, v: unknown) => (v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : typeof v === 'number' && Number.isNaN(v) ? null : v);
  fs.writeFileSync(out, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), audioIncluded: false, issue: Number(ISSUE_NUMBER), author: ISSUE_AUTHOR, records: accepted }, jsonSafe, 1));

  const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8' }).trim();
  git('config', 'user.name', 'sonora-bot');
  git('config', 'user.email', 'sonora-bot@users.noreply.github.com');
  try { git('checkout', '-B', branch); } catch { git('checkout', branch); }
  git('add', out);
  git('commit', '-m', `Contribución #${ISSUE_NUMBER}: ${accepted.length} registros de @${ISSUE_AUTHOR}`);
  git('push', '--force', 'origin', branch);
  const prBody = `Integra la contribución del issue #${ISSUE_NUMBER} (@${ISSUE_AUTHOR}).\n\n${report.join('\n')}\n\nEl flujo "Validar corpus" comentará aquí la validación con y sin estos registros. Cierra #${ISSUE_NUMBER} al fusionar.`;
  let prUrl = '';
  try { prUrl = gh('pr', 'create', '--repo', REPO!, '--head', branch, '--base', 'main', '--title', `Contribución #${ISSUE_NUMBER}: ${accepted.length} registros`, '--body', prBody); }
  catch { prUrl = gh('pr', 'view', branch, '--repo', REPO!, '--json', 'url', '--jq', '.url'); }
  comment(`Contribución procesada: **${accepted.length} registros** nuevos.\n\n${report.join('\n')}\n\nPull request: ${prUrl}`);
};

main().catch((e) => { try { comment(`El flujo automático falló: ${(e as Error).message}. Un mantenedor lo revisará.`); } catch { /* sin permisos para comentar */ } console.error(e); process.exit(1); });
