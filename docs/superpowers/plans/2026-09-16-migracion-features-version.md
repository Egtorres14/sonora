# Migración de la versión de características — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que subir `FEATURES_VERSION` no destruya colecciones, corpus ni modelo: los registros antiguos siguen puntuando, quedan fuera del entrenamiento con un contador visible, y los que tienen audio se reanalizan solos.

**Architecture:** Un módulo puro decide qué versiones acepta el código (misma mayor, menor ≤ actual) y cuáles son entrenables (exactamente la actual). El esquema de importación usa esa regla en vez de un literal. El entrenamiento, en la app y en CI, separa `current` de `stale` con una sola función. El reanálisis aprovecha el análisis que `select()` ya hace al abrir y añade un lote desde Modelo local. Una prueba guardiana falla si el corpus publicado no va en la versión del código.

**Tech Stack:** TypeScript, zod, React 19, IndexedDB vía `idb`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-migracion-features-version-design.md`

## Global Constraints

- **`FEATURES_VERSION` no cambia** en este trabajo. Sigue en `'2.1.0'` (`services/audio/features.ts:12`).
- **Regla de aceptación:** misma versión mayor que el código y menor ≤ la actual. Entrenable solo si es exactamente `FEATURES_VERSION`.
- **Registros antiguos sin audio se conservan**: puntúan, no entrenan, y se ven.
- **El reanálisis nunca pasa por el filtro de campos del estudiante**: no es una edición.
- **Todo texto en español con acentos.** Mensajes de error y avisos, también.
- **Verificación por tarea:** `npm run typecheck && npm test` en verde antes de cada commit.
- **Rama:** `migracion-features-version`, creada desde `main`.

---

### Task 1: Regla de versiones y guardián del corpus

**Files:**
- Create: `services/audio/version.ts`
- Modify: `services/audio/features.ts:1-12` (cabecera con la política)
- Test: `tests/feature-version.test.ts`, `tests/corpus-version.test.ts`

**Interfaces:**
- Consumes: `FEATURES_VERSION` de `services/audio/features.ts`; `DESCRIPTOR_VERSION` de `services/learning/descriptors.ts`.
- Produces:
  - `interface FeatureVersion { major: number; minor: number; patch: number }`
  - `parseFeatureVersion(v: string): FeatureVersion | null`
  - `acceptsFeatureVersion(v: string): boolean`
  - `isCurrentFeatures(f: { version: string }): boolean`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/feature-version.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FEATURES_VERSION } from '../services/audio/features';
import { acceptsFeatureVersion, isCurrentFeatures, parseFeatureVersion } from '../services/audio/version';

const current = parseFeatureVersion(FEATURES_VERSION)!;
const v = (major: number, minor: number, patch: number) => `${major}.${minor}.${patch}`;

describe('Regla de versiones de características', () => {
  it('parsea una versión y rechaza lo que no lo es', () => {
    expect(parseFeatureVersion('2.1.0')).toEqual({ major: 2, minor: 1, patch: 0 });
    expect(parseFeatureVersion('2.1')).toBeNull();
    expect(parseFeatureVersion('v2.1.0')).toBeNull();
    expect(parseFeatureVersion('')).toBeNull();
    expect(parseFeatureVersion('2.x.0')).toBeNull();
  });

  it('acepta la versión actual y las menores anteriores de la misma mayor', () => {
    expect(acceptsFeatureVersion(FEATURES_VERSION)).toBe(true);
    expect(acceptsFeatureVersion(v(current.major, current.minor, current.patch + 3))).toBe(true);
    if (current.minor > 0) expect(acceptsFeatureVersion(v(current.major, current.minor - 1, 0))).toBe(true);
  });

  it('rechaza otra mayor y una menor posterior a la del código', () => {
    expect(acceptsFeatureVersion(v(current.major - 1, 9, 0))).toBe(false);
    expect(acceptsFeatureVersion(v(current.major + 1, 0, 0))).toBe(false);
    expect(acceptsFeatureVersion(v(current.major, current.minor + 1, 0))).toBe(false);
    expect(acceptsFeatureVersion('no-es-version')).toBe(false);
  });

  it('solo la versión exacta es entrenable', () => {
    expect(isCurrentFeatures({ version: FEATURES_VERSION })).toBe(true);
    expect(isCurrentFeatures({ version: v(current.major, current.minor, current.patch + 1) })).toBe(false);
    expect(isCurrentFeatures({ version: v(current.major, 0, 0) })).toBe(false);
  });
});
```

Crear `tests/corpus-version.test.ts`:

```ts
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURES_VERSION } from '../services/audio/features';
import { DESCRIPTOR_VERSION } from '../services/learning/descriptors';

/**
 * Guardián: si alguien sube FEATURES_VERSION sin regenerar el corpus (`npm run corpus:build`,
 * sin red), la vista Muestras y el entrenamiento en CI dejarían de funcionar. Esta prueba lo
 * convierte en un fallo visible antes de llegar a main.
 */
describe('El corpus publicado va en la versión del código', () => {
  it('todos los registros de coleccion.json', () => {
    const collection = JSON.parse(fs.readFileSync('public/corpus/coleccion.json', 'utf8')) as { records: { features: { version: string; analysis: { version: string } } }[] };
    const versions = new Set(collection.records.flatMap(r => [r.features.version, r.features.analysis.version]));
    expect([...versions]).toEqual([FEATURES_VERSION]);
  });

  it('el modelo publicado usa los descriptores actuales', () => {
    const model = JSON.parse(fs.readFileSync('public/corpus/modelo.json', 'utf8')) as { featureVersion: string };
    expect(model.featureVersion).toBe(DESCRIPTOR_VERSION);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run tests/feature-version.test.ts tests/corpus-version.test.ts`
Expected: `feature-version` FAIL con `Failed to resolve import "../services/audio/version"`; `corpus-version` PASS (el corpus ya está en `2.1.0`; es el guardián para el futuro).

- [ ] **Step 3: Crear `services/audio/version.ts`**

```ts
/**
 * Qué versiones de características puede leer este código y cuáles puede entrenar.
 *
 * Mayor: cambia la forma (campos que desaparecen o cambian de tipo). Menor: campos nuevos, que
 * entran como opcionales en el esquema. Parche: mismos campos, recalculados con otro algoritmo.
 *
 * Leer acepta la misma mayor con menor ≤ la actual. Entrenar exige la versión exacta: mezclar
 * mediciones de dos algoritmos en un mismo entrenamiento contaminaría los datos sin que se note.
 */
import { FEATURES_VERSION } from './features';

export interface FeatureVersion { major: number; minor: number; patch: number }

export const parseFeatureVersion = (version: string): FeatureVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
};

const CURRENT = parseFeatureVersion(FEATURES_VERSION)!;

export const acceptsFeatureVersion = (version: string): boolean => {
  const parsed = parseFeatureVersion(version);
  return !!parsed && parsed.major === CURRENT.major && parsed.minor <= CURRENT.minor;
};

export const isCurrentFeatures = (features: { version: string }): boolean => features.version === FEATURES_VERSION;
```

- [ ] **Step 4: Escribir la política en la cabecera de `features.ts`**

Sustituir las líneas 1-4 de `services/audio/features.ts`:

```ts
/**
 * Extracción de características objetivas a partir de audio decodificado.
 * Puro (sin DOM): se ejecuta en un Web Worker o en Node (tests).
 *
 * Al cambiar FEATURES_VERSION (la regla completa está en ./version.ts):
 *  - un campo nuevo → sube la MENOR y entra como `.optional()` en services/library-schema.ts;
 *  - un campo que desaparece o cambia de tipo → sube la MAYOR;
 *  - mismos campos con otro algoritmo → sube el PARCHE;
 *  - en el mismo cambio: `npm run corpus:build` y commitear public/corpus (tests/corpus-version.test.ts falla si no).
 * Los registros antiguos siguen puntuando; solo entrenan los que están en la versión exacta.
 */
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `npx vitest run tests/feature-version.test.ts tests/corpus-version.test.ts && npm run typecheck`
Expected: PASS, 4 + 2 pruebas; typecheck sin errores.

- [ ] **Step 6: Commit**

```bash
git add services/audio/version.ts services/audio/features.ts tests/feature-version.test.ts tests/corpus-version.test.ts
git commit -m "Regla de versiones de características y guardián del corpus publicado"
```

---

### Task 2: El esquema acepta versiones compatibles

**Files:**
- Modify: `services/library-schema.ts:24,35`
- Test: `tests/feature-version-schema.test.ts`

**Interfaces:**
- Consumes: `acceptsFeatureVersion` (Task 1); `exportDataset`, `parseDataset` de `services/library.ts`; `calculateReview` de `services/review.ts`.
- Produces: nada nuevo; `parseDataset` deja de rechazar versiones anteriores compatibles.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/feature-version-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { exportDataset, parseDataset } from '../services/library';
import { calculateReview, createReview, type ReviewRecord } from '../services/review';
import { extractFeatures, FEATURES_VERSION } from '../services/audio/features';
import { parseFeatureVersion } from '../services/audio/version';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000)], 48000))!);
const current = parseFeatureVersion(FEATURES_VERSION)!;
const v = (major: number, minor: number, patch: number) => `${major}.${minor}.${patch}`;
/** Mismos campos, otra versión: simula un registro medido por una versión anterior del DSP. */
const atVersion = (version: string): ReviewRecord => {
  const record = createReview('c'.repeat(64), 'antigua.wav', features);
  return { ...record, features: { ...record.features, version, analysis: { ...record.features.analysis, version } } };
};
const roundtrip = (record: ReviewRecord) => parseDataset(exportDataset([record]));

describe('Importar colecciones de versiones anteriores', () => {
  it('acepta una versión menor anterior de la misma mayor y conserva su versión', () => {
    const older = v(current.major, Math.max(0, current.minor - 1), 0);
    const restored = roundtrip(atVersion(older));
    expect(restored[0].features.version).toBe(older);
  });

  it('acepta un parche distinto', () => {
    expect(roundtrip(atVersion(v(current.major, current.minor, current.patch + 2)))).toHaveLength(1);
  });

  it('rechaza otra versión mayor, en cualquier dirección', () => {
    expect(() => roundtrip(atVersion(v(current.major - 1, 9, 0)))).toThrow();
    expect(() => roundtrip(atVersion(v(current.major + 1, 0, 0)))).toThrow();
  });

  it('rechaza una versión menor posterior a la del código', () => {
    expect(() => roundtrip(atVersion(v(current.major, current.minor + 1, 0)))).toThrow();
  });

  it('un registro antiguo puntúa igual que uno actual con las mismas medidas', () => {
    const older = atVersion(v(current.major, 0, 0));
    const now = createReview('c'.repeat(64), 'antigua.wav', features);
    expect(calculateReview(older).technical.total).toBe(calculateReview(now).technical.total);
    expect(calculateReview(older).formal.total).toBe(calculateReview(now).formal.total);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run tests/feature-version-schema.test.ts`
Expected: FAIL en «acepta una versión menor anterior» y «acepta un parche distinto» (el literal rechaza todo lo que no sea `2.1.0`). Si `current.minor` es 0, la primera prueba usa `x.0.0` y también falla por el parche.

- [ ] **Step 3: Sustituir los literales del esquema**

En `services/library-schema.ts`, añadir el import:

```ts
import { acceptsFeatureVersion } from './audio/version';
```

Justo después de `const label = ...` añadir:

```ts
// Misma mayor y menor ≤ la del código (services/audio/version.ts). Un literal destruía toda
// colección exportada en cuanto cambiaba la versión.
const featureVersion = z.string().refine(acceptsFeatureVersion, 'Versión de características no compatible con esta aplicación');
```

Sustituir en `features` (línea 24):

```ts
  version: featureVersion,
```

y en `analysis` (línea 35):

```ts
  analysis: z.object({ version: featureVersion, elapsedMs: nonnegative, warnings: z.array(text).max(100) }),
```

Eliminar `FEATURES_VERSION` del import de `./audio/features` si ya no se usa en el archivo.

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npx vitest run tests/feature-version-schema.test.ts && npm test`
Expected: PASS, 5 pruebas; la batería completa sigue en verde (incluida `tests/library.test.ts`, que rechaza `version: 99` a nivel de colección, no de características).

- [ ] **Step 5: Commit**

```bash
git add services/library-schema.ts tests/feature-version-schema.test.ts
git commit -m "El esquema acepta versiones de características compatibles en vez de un literal"
```

---

### Task 3: El entrenamiento ignora los registros antiguos sin fallar

**Files:**
- Modify: `services/learning/model.ts` (nueva función exportada), `scripts/contrib/train-community.ts:32-50`
- Test: `tests/feature-version-training.test.ts`

**Interfaces:**
- Consumes: `isCurrentFeatures` (Task 1).
- Produces: `splitByFeatureVersion<T extends { features: { version: string } }>(records: T[]): { current: T[]; stale: T[] }` en `services/learning/model.ts`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/feature-version-training.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { splitByFeatureVersion, trainLocalModel, trainingReadiness } from '../services/learning/model';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures, FEATURES_VERSION } from '../services/audio/features';
import { parseFeatureVersion } from '../services/audio/version';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const base = extractFeatures(decodePcm(encodeWav16([new Float32Array(4800)], 48000))!);
const current = parseFeatureVersion(FEATURES_VERSION)!;
const OLDER = `${current.major}.0.${current.minor === 0 ? current.patch + 1 : 0}`;

/** 24 muestras reales, 12 orígenes, filtros presente/ausente separable por espectro (como tests/learning.test.ts). */
const corpus = (): ReviewRecord[] => Array.from({ length: 24 }, (_, i) => {
  const positive = i % 2 === 0;
  const r = createReview(i.toString(16).padStart(64, '0'), `muestra-${i}.wav`, { ...base, spectrum: { ...base.spectrum, flatness: positive ? 0.9 : 0.1, centroidHz: positive ? 6000 : 200, ltas: base.spectrum.ltas.map((b, j) => ({ ...b, db: positive ? -j : j - 48 })) } });
  return { ...r, sourceGroup: `origen-${Math.floor(i / 2)}`, labels: { ...r.labels, filtros: positive ? 'present' as const : 'absent' as const } };
});
const age = (r: ReviewRecord): ReviewRecord => ({ ...r, features: { ...r.features, version: OLDER, analysis: { ...r.features.analysis, version: OLDER } } });

describe('Entrenar con registros de versiones anteriores en la colección', () => {
  it('separa lo entrenable de lo que necesita reanálisis sin mutar', () => {
    const all = corpus().map((r, i) => (i < 4 ? age(r) : r));
    const { current: now, stale } = splitByFeatureVersion(all);
    expect(now).toHaveLength(20);
    expect(stale).toHaveLength(4);
    expect(all).toHaveLength(24);
    expect(stale.every(r => r.features.version === OLDER)).toBe(true);
  });

  it('sin registros antiguos, todo es entrenable', () => {
    expect(splitByFeatureVersion(corpus()).stale).toEqual([]);
  });

  it('un registro antiguo hacía fallar el entrenamiento entero; con la separación, entrena', () => {
    const all = corpus().map((r, i) => (i < 2 ? age(r) : r));
    expect(() => trainLocalModel(all)).toThrow(/incompatible/i);
    const model = trainLocalModel(splitByFeatureVersion(all).current);
    expect(model.effects.filtros).toBeDefined();
    expect(model.trainingSampleIds).toHaveLength(22);
  });

  it('la cobertura solo cuenta lo entrenable', () => {
    const all = corpus().map((r, i) => (i < 6 ? age(r) : r));
    const filtros = trainingReadiness(splitByFeatureVersion(all).current).find(r => r.effect === 'filtros')!;
    expect(filtros.labeledRealSamples).toBe(18);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run tests/feature-version-training.test.ts`
Expected: FAIL — `splitByFeatureVersion` no está exportado.

- [ ] **Step 3: Añadir la función**

En `services/learning/model.ts`, añadir el import:

```ts
import { isCurrentFeatures } from '../audio/version';
```

Y, justo antes de `export const trainingReadiness`, añadir:

```ts
/**
 * Lo que puede entrenar y lo que necesita reanálisis. `describeAudio` lanza con una versión
 * distinta, y antes bastaba un registro antiguo para que fallara todo el entrenamiento.
 * Lo usan la aplicación (LearningView) y CI (scripts/contrib/train-community.ts).
 */
export const splitByFeatureVersion = <T extends { features: { version: string } }>(records: T[]): { current: T[]; stale: T[] } => ({
  current: records.filter(r => isCurrentFeatures(r.features)),
  stale: records.filter(r => !isCurrentFeatures(r.features)),
});
```

- [ ] **Step 4: Usarla en CI**

En `scripts/contrib/train-community.ts`, cambiar el import de `../../services/learning/model` para incluirla:

```ts
import { splitByFeatureVersion, trainingReadiness, trainLocalModel } from '../../services/learning/model';
```

Sustituir las líneas

```ts
const readiness = trainingReadiness(samples);
const t0 = Date.now();
const model = trainLocalModel(samples);
```

por

```ts
// Los registros de versiones anteriores puntúan en la aplicación, pero no entrenan.
const { current: trainable, stale: outdated } = splitByFeatureVersion(samples);
const readiness = trainingReadiness(trainable);
const t0 = Date.now();
const model = trainLocalModel(trainable);
```

Y en la línea del resumen que empieza por `Colecciones: ${files.length}`, sustituir `registros únicos: ${samples.length}` por:

```ts
registros únicos: ${samples.length} · en versión anterior (excluidos): ${outdated.length}
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `npx vitest run tests/feature-version-training.test.ts && npm test && npm run typecheck`
Expected: PASS, 4 pruebas; batería y tipos en verde.

- [ ] **Step 6: Commit**

```bash
git add services/learning/model.ts scripts/contrib/train-community.ts tests/feature-version-training.test.ts
git commit -m "El entrenamiento separa los registros de versiones anteriores en vez de fallar"
```

---

### Task 4: Reanálisis al abrir y por lotes, con su interfaz

**Files:**
- Modify: `services/library.ts` (método `audioIds`), `components/workspace/useWorkspace.ts`, `App.tsx`, `components/workspace/LearningView.tsx`, `components/workspace/LibraryView.tsx`, `components/workspace/AnalysisView.tsx:70`, `components/workspace/ModelAdvice.tsx:21-23`, `styles.css`

**Interfaces:**
- Consumes: `isCurrentFeatures` (Task 1), `splitByFeatureVersion` (Task 3), `analyzeFile` y `updateReview` ya importados en `useWorkspace.ts`.
- Produces:
  - `library.audioIds(): Promise<string[]>`
  - En `useWorkspace`: `audioIds: Set<string>`, `reanalyze(): Promise<void>`.
  - `LearningView` gana las props `audioIds: Set<string>`, `reanalyzing: boolean`, `onReanalyze: () => Promise<void>`.

**Nota de verificación:** no hay pruebas de componentes en el proyecto; la puerta de esta tarea es `npm run typecheck && npm test && npm run build`. El comportamiento lo cubre la Task 5. No se declara probada hasta que la Task 5 esté en verde.

- [ ] **Step 1: Saber qué registros tienen audio**

En `services/library.ts`, dentro del objeto que devuelve `createLibrary`, después de `async audio(id: string) { ... },` añadir:

```ts
    /** Ids con audio guardado: solo esos se pueden reanalizar. */
    async audioIds() { return (await connect()).getAllKeys('audio'); },
```

- [ ] **Step 2: Estado y reanálisis en `useWorkspace.ts`**

Añadir el import:

```ts
import { splitByFeatureVersion } from '../../services/learning/model';
```

(Ya se importa `isModelStale` desde ese módulo: unificar en una sola línea de import.)

Añadir estado junto a `modelHistory`:

```ts
  const [audioIds, setAudioIds] = useState<Set<string>>(new Set());
```

Sustituir `const refresh = async () => replaceRecords(await library.list());` por:

```ts
  const refresh = async () => { const [items, ids] = await Promise.all([library.list(), library.audioIds()]); replaceRecords(items); setAudioIds(new Set(ids)); };
```

En el `useEffect` de arranque, sustituir `Promise.all([library.list(), library.model(), library.modelHistory()]).then(([items, savedModel, history]) => { if (live) { replaceRecords(items); setModel(savedModel ?? null); setModelHistory(history); } })` por:

```ts
Promise.all([library.list(), library.model(), library.modelHistory(), library.audioIds()]).then(([items, savedModel, history, ids]) => { if (live) { replaceRecords(items); setModel(savedModel ?? null); setModelHistory(history); setAudioIds(new Set(ids)); } })
```

Justo después de la función `change`, añadir:

```ts
  /**
   * Guarda una medición repetida sobre el mismo audio. No es una edición: no pasa por el filtro de
   * campos del estudiante y la puede provocar cualquier rol al abrir la muestra. Al cambiar
   * `features`, `updateReview` mueve `trainingUpdatedAt` y el modelo caduca, que es lo correcto.
   */
  const refreshFeatures = (id: string, features: ReviewRecord['features']) => {
    const current = recordsRef.current.find(r => r.id === id);
    if (!current || current.features.version === features.version) return;
    const next = updateReview(current, { features }, maxManual);
    replaceRecords(recordsRef.current.map(r => r.id === id ? next : r));
    saveQueue.queue(next);
  };
```

En `select`, sustituir

```ts
        if (!controller.signal.aborted) { setBlob(playbackBlob(audio, result)); setAnalyzed(result); }
```

por

```ts
        if (!controller.signal.aborted) { setBlob(playbackBlob(audio, result)); setAnalyzed(result); refreshFeatures(record.id, result.features); }
```

Justo antes de `const demo = ...`, añadir:

```ts
  /** Reanaliza, uno a uno, los registros de versiones anteriores que tienen audio guardado. */
  const reanalyze = async () => {
    if (!isTeacher || abort.current) return;
    const outdated = splitByFeatureVersion(recordsRef.current).stale;
    const withAudio = outdated.filter(r => audioIds.has(r.id));
    if (!withAudio.length) { setNotice(`${outdated.length} muestra(s) en una versión anterior, ninguna con audio guardado: siguen puntuando, pero no entrenan hasta volver a subir el original.`); return; }
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(''); setNotice('');
    let done = 0;
    try {
      for (const [i, record] of withAudio.entries()) {
        if (controller.signal.aborted) break;
        const audio = await library.audio(record.id);
        if (!audio) continue;
        const result = await analyzeFile(new File([audio], record.name, { type: audio.type }), text => setStage(`${i + 1}/${withAudio.length} · ${record.name} · ${text}`), controller.signal);
        if (controller.signal.aborted) break;
        refreshFeatures(record.id, result.features); done++;
      }
      await saveQueue.flush(); await refresh();
      const skipped = outdated.length - withAudio.length;
      setNotice(`${done} muestra(s) reanalizada(s)${skipped ? ` · ${skipped} sin audio, siguen puntuables` : ''}${controller.signal.aborted ? ' · cancelado' : ''}.`);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudo reanalizar.'); }
    finally { setBusy(false); setStage(''); abort.current = null; }
  };
```

Añadir `audioIds` y `reanalyze` al objeto que devuelve el hook (junto a `modelHistory` y `clearSelection`).

- [ ] **Step 3: Pasar las props desde `App.tsx`**

Sustituir

```tsx
<LearningView records={w.allRecords} model={w.model} history={w.modelHistory} stale={modelStale} onModel={w.saveModel} onLibrary={() => w.setView('library')} />
```

por

```tsx
<LearningView records={w.allRecords} model={w.model} history={w.modelHistory} stale={modelStale} audioIds={w.audioIds} reanalyzing={w.busy} onReanalyze={w.reanalyze} onModel={w.saveModel} onLibrary={() => w.setView('library')} />
```

- [ ] **Step 4: Contador y botón en `LearningView.tsx`**

Cambiar el import de `../../services/learning/model` a:

```ts
import { splitByFeatureVersion, trainingReadiness } from '../../services/learning/model';
```

Añadir el icono `RefreshCw` al import de `lucide-react`.

Sustituir la interfaz `Props` por:

```ts
interface Props { records: ReviewRecord[]; model: LocalModel | null; history: ModelSnapshot[]; stale: boolean; audioIds: Set<string>; reanalyzing: boolean; onReanalyze: () => Promise<void>; onModel: (model: LocalModel) => Promise<void>; onLibrary: () => void }
```

y la firma por:

```ts
export default function LearningView({ records, model, history, stale, audioIds, reanalyzing, onReanalyze, onModel, onLibrary }: Props) {
```

Sustituir

```ts
  const readiness = trainingReadiness(records), ready = readiness.filter(r => r.eligible);
  const real = records.filter(r => r.origin === 'real');
```

por

```ts
  // Los registros de versiones anteriores puntúan, pero no entrenan hasta reanalizarse.
  const { current: trainable, stale: outdated } = splitByFeatureVersion(records);
  const reanalyzable = outdated.filter(r => audioIds.has(r.id)).length;
  const readiness = trainingReadiness(trainable), ready = readiness.filter(r => r.eligible);
  const real = trainable.filter(r => r.origin === 'real');
```

Sustituir `await onModel(await trainInWorker(records, abort.current.signal));` por `await onModel(await trainInWorker(trainable, abort.current.signal));`.

Justo después de `{stale && <p className="notice">La colección ha cambiado desde el entrenamiento. Reentrena antes de usar sus sugerencias.</p>}` añadir:

```tsx
{outdated.length > 0 && <div className="outdated-note" data-testid="outdated-note"><p><b>{outdated.length}</b> muestra(s) en una versión anterior: puntúan, pero no entrenan.{reanalyzable ? ` ${reanalyzable} tienen audio guardado y se pueden reanalizar aquí.` : ' Ninguna tiene audio guardado: vuelve a subir los originales y se reconocerán por su huella.'}</p><button type="button" className="button secondary" disabled={!reanalyzable || reanalyzing || busy} onClick={() => void onReanalyze()}><RefreshCw size={14} /> Reanalizar las que tienen audio</button></div>}
```

- [ ] **Step 5: Pastilla en la biblioteca**

En `components/workspace/LibraryView.tsx`, añadir el import:

```ts
import { isCurrentFeatures } from '../../services/audio/version';
```

Sustituir

```tsx
<td><span className={`pill ${labelProgress(r) === 5 ? 'positive' : ''}`}>{labelProgress(r)} / 5 etiquetas</span></td>
```

por

```tsx
<td><span className={`pill ${labelProgress(r) === 5 ? 'positive' : ''}`}>{labelProgress(r)} / 5 etiquetas</span>{!isCurrentFeatures(r.features) && <small className="publish-tag outdated-tag">reanálisis pendiente</small>}</td>
```

- [ ] **Step 6: Aviso en el análisis y en el clasificador local**

En `components/workspace/AnalysisView.tsx`, añadir el import:

```ts
import { isCurrentFeatures } from '../../services/audio/version';
```

Justo después de la línea 70 (`{record.features.analysis.warnings.length > 0 && <details className="measurement-warnings">…</details>}`) añadir:

```tsx
      {!isCurrentFeatures(record.features) && !audioUrl && <p className="notice" data-testid="outdated-record">Esta muestra se midió con una versión anterior ({record.features.version}). Su nota sigue siendo válida, pero no entra en el entrenamiento. Vuelve a subir el archivo original: se reconocerá por su huella y se medirá de nuevo.</p>}
```

En `components/workspace/ModelAdvice.tsx`, añadir el mismo import y sustituir

```tsx
{!model ? <p>No hay un modelo disponible. Reúne muestras etiquetadas en la biblioteca y entrénalo desde «Modelo local».</p> : seen ? <p>
```

por

```tsx
{!model ? <p>No hay un modelo disponible. Reúne muestras etiquetadas en la biblioteca y entrénalo desde «Modelo local».</p> : !isCurrentFeatures(record.features) ? <p>Esta muestra se midió con una versión anterior de las características y el clasificador no puede leerla. Ábrela con su audio o vuelve a subir el original para reanalizarla.</p> : seen ? <p>
```

- [ ] **Step 7: Estilos**

Añadir al final de `styles.css`:

```css

/* --- Registros de versiones anteriores --- */
.outdated-note { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; padding: 12px 14px; border: 1px solid #655139; border-radius: 6px; background: #332d23; font-size: 11px; line-height: 1.7; color: #d1b896; }
.outdated-note p { flex: 1 1 260px; }
.outdated-tag { margin-left: 8px; color: #e0a63b; }
```

- [ ] **Step 8: Comprobar tipos, batería y compilación**

Run: `npm run typecheck && npm test && npm run build`
Expected: sin errores de tipos, batería en verde, build correcto.

- [ ] **Step 9: Commit**

```bash
git add services/library.ts components/workspace/useWorkspace.ts App.tsx components/workspace/LearningView.tsx components/workspace/LibraryView.tsx components/workspace/AnalysisView.tsx components/workspace/ModelAdvice.tsx styles.css
git commit -m "Reanálisis de registros antiguos al abrir y por lotes, con contador y aviso"
```

---

### Task 5: Pruebas de navegador y documentación

**Files:**
- Modify: `tests/e2e/workspace.spec.ts`, `README.md`, `docs/GUIA-PROFESOR.md`

**Interfaces:**
- Consumes: todo lo anterior. La base de datos de IndexedDB se llama `sonora-library-v1`, almacén `reviews` con `keyPath: 'id'`.

- [ ] **Step 1: Escribir las pruebas end to end**

Añadir a los imports de `tests/e2e/workspace.spec.ts`:

```ts
import { FEATURES_VERSION } from '../../services/audio/features';
```

Añadir al final del archivo:

```ts
/** Una colección exportada con un registro medido por una versión anterior del DSP, sin audio. */
const olderCollection = () => {
  const sr = 48000;
  const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(sr * 2)], sr))!);
  const [major] = FEATURES_VERSION.split('.');
  const version = `${major}.0.0`;
  const record = createReview('e'.repeat(64), 'antigua_sin_audio.wav', { ...features, version, analysis: { ...features.analysis, version } });
  return { name: 'antigua.json', mimeType: 'application/json', buffer: Buffer.from(exportDataset([{ ...record, sourceGroup: 'legado-01', synopsis: 'Registro de una versión anterior.' }])) };
};

test('un registro de una versión anterior sin audio puntúa, se señala y no entrena', async ({ page }) => {
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByLabel('Importar colección JSON').setInputFiles(olderCollection());
  await expect(page.locator('.notice-banner')).toContainText('1 registros importados');
  await expect(page.locator('tbody tr')).toContainText('reanálisis pendiente');

  await page.getByRole('button', { name: /Modelo local/ }).click();
  await expect(page.getByTestId('outdated-note')).toContainText('1 muestra(s) en una versión anterior');
  await expect(page.getByRole('button', { name: 'Reanalizar las que tienen audio' })).toBeDisabled();

  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^antigua_sin_audio/ }).click();
  await expect(page.getByTestId('outdated-record')).toContainText('versión anterior');
  await expect(page.getByTestId('final-score')).toBeVisible();
});

test('abrir un registro antiguo con audio lo reanaliza y lo pone al día', async ({ page }) => {
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-topline')).not.toContainText('Guardando cambios');

  // Se envejece el registro directamente en IndexedDB, como si lo hubiera medido una versión anterior.
  await page.evaluate(([major]) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('sonora-library-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('reviews', 'readwrite');
      const store = tx.objectStore('reviews');
      const all = store.getAll();
      all.onsuccess = () => { for (const r of all.result) { r.features.version = `${major}.0.0`; r.features.analysis.version = `${major}.0.0`; store.put(r); } };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), [FEATURES_VERSION.split('.')[0]]);
  await page.reload();

  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await expect(page.locator('tbody tr')).toContainText('reanálisis pendiente');
  await page.getByRole('button', { name: /Modelo local/ }).click();
  await expect(page.getByRole('button', { name: 'Reanalizar las que tienen audio' })).toBeEnabled();

  // Abrirla basta: el análisis que ya se hace al abrir guarda las características nuevas.
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();
  await expect(page.locator('.analysis-progress')).toHaveCount(0);
  await expect(page.locator('.workspace-topline')).not.toContainText('Guardando cambios');
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await expect(page.locator('tbody tr')).not.toContainText('reanálisis pendiente');
});
```

- [ ] **Step 2: Ejecutar y comprobar que pasan**

Run: `npx playwright test workspace.spec.ts -g "versión anterior|lo pone al día"`
Expected: PASS, 2 pruebas.

Si la segunda falla en `not.toContainText('reanálisis pendiente')`, la cola de guardado no había vaciado antes de volver a la biblioteca: la espera `not.toContainText('Guardando cambios')` es la que lo cubre; comprobar que sigue ahí y no sustituirla por un `waitForTimeout`.

- [ ] **Step 3: Documentar**

En `README.md`, en la línea que empieza por `- **Modelo local:**`, añadir al final:

```markdown
 Los registros medidos por una versión anterior de las características siguen puntuando, quedan fuera del entrenamiento con un contador visible y se reanalizan solos al abrirlos si tienen audio guardado (o por lotes desde Modelo local).
```

En `docs/GUIA-PROFESOR.md`, al final de la sección «## 8. Muestras y modelo local» (justo antes de «## 9. Exportar y contribuir»), añadir:

```markdown
### Muestras de una versión anterior

Cuando la aplicación mejora la forma de medir, las muestras medidas antes siguen valiendo para la nota, pero no entran en el entrenamiento hasta medirse de nuevo. En **Modelo local** verás cuántas hay y un botón para reanalizar las que tienen audio guardado; también basta con abrir una de ellas. Las importadas sin audio se quedan como están: vuelve a subir el original y se reconocerá por su huella.
```

- [ ] **Step 4: Verificación completa**

Run: `npm run typecheck && npm test && npm run build && npx playwright test`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/workspace.spec.ts README.md docs/GUIA-PROFESOR.md
git commit -m "Pruebas de navegador de los registros de versiones anteriores y documentación"
```

---

## Notas para quien ejecute

- **No subas `FEATURES_VERSION`.** Este trabajo deja el mecanismo listo; el cambio de versión es del bloque D y exige regenerar el corpus en el mismo commit.
- **`refreshFeatures` no filtra por rol a propósito.** Es una medición repetida, no una edición. No la hagas pasar por `change`.
- **`splitByFeatureVersion` es la única puerta al entrenamiento**, en la app y en CI. No añadas otro filtro por versión en otro sitio.
- Si una prueba de navegador es frágil, **dilo en el test** con un comentario; no la borres ni la omitas en silencio.
