/**
 * Descarga las grabaciones fuente listadas en corpus/sources/catalog.json y escribe manifest.json.
 *
 *   npx tsx scripts/corpus/fetch-sources.ts [--dir corpus/sources]
 *
 * catalog.json: [{ id, category, description, url, format, license, attribution, sourcePage }]
 * Solo se conservan las entradas cuya descarga responde 200 con un cuerpo de audio no vacío.
 */
import fs from 'node:fs';
import path from 'node:path';

interface CatalogEntry { id: string; category: string; description: string; url: string; format: string; license: string; attribution: string; sourcePage: string; verified?: boolean }

const dirArg = process.argv.indexOf('--dir');
const dir = dirArg >= 0 ? process.argv[dirArg + 1] : 'corpus/sources';
const filesDir = path.join(dir, 'files');
fs.mkdirSync(filesDir, { recursive: true });

const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8')) as CatalogEntry[];
const manifest: { id: string; file: string; category: string; description: string; license: string; attribution: string; sourceUrl: string }[] = [];

const extOf = (entry: CatalogEntry) => {
  const m = entry.url.match(/\.(wav|flac|ogg|oga|mp3|aiff?|opus)(\?|$)/i);
  return (m ? m[1] : entry.format || 'bin').toLowerCase().replace('aif', 'aiff').replace('aiffff', 'aiff');
};

for (const entry of catalog) {
  const file = `${entry.id}.${extOf(entry)}`;
  const target = path.join(filesDir, file);
  try {
    if (!fs.existsSync(target) || fs.statSync(target).size < 1024) {
      // Wikimedia limita la tasa: esperamos entre descargas y reintentamos los 429 con espera creciente.
      let res: Response | null = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        await new Promise((r) => setTimeout(r, attempt === 1 ? 1500 : 5000 * attempt));
        res = await fetch(entry.url, { headers: { 'User-Agent': 'SonoraCorpusBuilder/1.0 (https://github.com/sonora-lab/corpus; educational research; mailto:corpus@sonora.invalid)' }, redirect: 'follow' });
        if (res.status !== 429) break;
        console.log(`    · ${entry.id}: 429, reintento ${attempt}/5`);
      }
      if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error('respuesta vacía');
      const head = buf.subarray(0, 4).toString('latin1');
      if (head.startsWith('<') || head.startsWith('{')) throw new Error('la URL devuelve HTML/JSON, no audio');
      fs.writeFileSync(target, buf);
      console.log(`  ✓ ${entry.id} (${(buf.length / 1e6).toFixed(2)} MB)`);
    } else console.log(`  = ${entry.id} (ya descargado)`);
    manifest.push({ id: entry.id, file, category: entry.category, description: entry.description, license: entry.license, attribution: entry.attribution, sourceUrl: entry.sourcePage || entry.url });
  } catch (e) {
    console.warn(`  ✗ ${entry.id}: ${(e as Error).message}`);
  }
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`\nManifest: ${manifest.length}/${catalog.length} fuentes en ${path.join(dir, 'manifest.json')}`);
