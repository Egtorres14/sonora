# Marcado manual de puntos en el audio — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el profesor marque sobre la forma de onda dónde ocurre cada herramienta de la rúbrica, con un comentario, y que esas marcas sean la evidencia localizada que sostiene la nota.

**Architecture:** Una capa de datos pura (`services/marks.ts`) que devuelve parches completos de `ReviewRecord`, de modo que marca y etiqueta propuesta viajan en un solo `onChange` y la cola de guardado escribe una vez. La lista de evidencias da prioridad a las marcas sobre el texto libre. El reproductor gana regiones editables y zoom; un componente nuevo aporta la barra de marcado y una lista editable que funciona sin ratón y sin audio.

**Tech Stack:** React 19, TypeScript, wavesurfer.js 7.12.11 (plugin Regions), zod, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-marcado-manual-design.md`

## Global Constraints

- **Idioma:** todo el texto de interfaz, comentarios y mensajes de error en español, con acentos correctos.
- **Herramientas:** exactamente las cinco de la rúbrica. `ToolId = 'pitch_shift' | 'reversa' | 'time_stretch' | 'loops' | 'filtros'` (`services/scoring/rubric.ts:12`).
- **Marca mínima:** `MIN_MARK_SECONDS = 0.05`. **Tope:** `MAX_MARKS = 200` por registro. **Comentario:** `MAX_NOTE = 2000` caracteres.
- **Umbral de arrastre:** 3 px.
- **Niveles de zoom:** `[ajustar, 50, 100, 200, 400]` px/s, donde «ajustar» es `ancho del contenedor / duración` (nunca `zoom(0)`).
- **Marcar propone la etiqueta una sola vez**, solo si estaba en `'unknown'`. Borrar una marca **nunca** cambia la etiqueta.
- **Visibilidad:** el estudiante ve marcas solo si `record.published`. `editable` solo para el profesor.
- **`DatasetSchema.version` sigue en 1.** `marks` es opcional; una colección antigua debe seguir validando.
- **No tocar** `changesTraining` en `services/review.ts`: marcar no caduca el modelo local.
- **Verificación de cada tarea:** `npm run typecheck && npm test` en verde antes de commit.

---

### Task 1: Capa de datos de las marcas

**Files:**
- Create: `services/marks.ts`
- Modify: `services/review.ts` (interfaz `ReviewRecord`, añadir `marks?`)
- Test: `tests/marks.test.ts`

**Interfaces:**
- Consumes: `ReviewRecord`, `EffectLabels` de `services/review.ts`; `ToolId` de `services/scoring/rubric.ts`.
- Produces:
  - `interface AudioMark { id: string; effect: ToolId; start: number; end: number; note: string; createdAt: string }`
  - `MIN_MARK_SECONDS = 0.05`, `MAX_MARKS = 200`, `MAX_NOTE = 2000`
  - `EFFECT_COLOR: Record<ToolId, string>`
  - `interface MarkPatch { patch: Partial<ReviewRecord>; proposedLabel: ToolId | null }`
  - `createMark(effect: ToolId, start: number, end: number, duration: number): AudioMark`
  - `addMark(record: ReviewRecord, mark: AudioMark): MarkPatch`
  - `updateMark(record: ReviewRecord, id: string, changes: Partial<Pick<AudioMark, 'start' | 'end' | 'note'>>, duration: number): MarkPatch`
  - `removeMark(record: ReviewRecord, id: string): MarkPatch`
  - `marksFor(record: ReviewRecord, effect: ToolId): AudioMark[]`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/marks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_MARKS, MIN_MARK_SECONDS, addMark, createMark, marksFor, removeMark, updateMark } from '../services/marks';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const DURATION = 20;
const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000 * DURATION)], 48000))!);
const record = (): ReviewRecord => createReview('f'.repeat(64), 'pieza.wav', features);

describe('Marcas sobre el audio', () => {
  it('recorta la marca a la duración del archivo', () => {
    const mark = createMark('reversa', -3, 999, DURATION);
    expect(mark.start).toBe(0);
    expect(mark.end).toBe(DURATION);
  });

  it('ordena inicio y final aunque se arrastre hacia atrás', () => {
    const mark = createMark('loops', 12, 4, DURATION);
    expect(mark.start).toBe(4);
    expect(mark.end).toBe(12);
  });

  it('impone la duración mínima', () => {
    const mark = createMark('filtros', 5, 5.001, DURATION);
    expect(mark.end - mark.start).toBeCloseTo(MIN_MARK_SECONDS, 3);
  });

  it('propone la etiqueta al crear la primera marca de una herramienta pendiente', () => {
    const base = record();
    const { patch, proposedLabel } = addMark(base, createMark('reversa', 12, 18, DURATION));
    expect(proposedLabel).toBe('reversa');
    expect(patch.labels?.reversa).toBe('present');
    expect(patch.marks).toHaveLength(1);
  });

  it('no toca una etiqueta ya decidida', () => {
    const base = { ...record(), labels: { ...record().labels, reversa: 'absent' as const } };
    const { patch, proposedLabel } = addMark(base, createMark('reversa', 12, 18, DURATION));
    expect(proposedLabel).toBeNull();
    expect(patch.labels).toBeUndefined();
  });

  it('no vuelve a proponer con la segunda marca', () => {
    const base = record();
    const first = addMark(base, createMark('reversa', 1, 3, DURATION));
    const withOne = { ...base, ...first.patch } as ReviewRecord;
    const second = addMark(withOne, createMark('reversa', 8, 9, DURATION));
    expect(second.proposedLabel).toBeNull();
  });

  it('borrar la última marca deja la etiqueta intacta', () => {
    const base = record();
    const added = addMark(base, createMark('reversa', 12, 18, DURATION));
    const withOne = { ...base, ...added.patch } as ReviewRecord;
    const removed = removeMark(withOne, withOne.marks![0].id);
    expect(removed.patch.marks).toEqual([]);
    expect(removed.patch.labels).toBeUndefined();
    expect(withOne.labels.reversa).toBe('present');
  });

  it('mantiene las marcas ordenadas por tiempo', () => {
    let current = record();
    for (const start of [9, 2, 5]) current = { ...current, ...addMark(current, createMark('loops', start, start + 1, DURATION)).patch } as ReviewRecord;
    expect(current.marks!.map(m => m.start)).toEqual([2, 5, 9]);
  });

  it('edita tiempos y comentario sin proponer etiqueta', () => {
    const base = record();
    const added = addMark(base, createMark('filtros', 3, 6, DURATION));
    const withOne = { ...base, ...added.patch } as ReviewRecord;
    const edited = updateMark(withOne, withOne.marks![0].id, { end: 999, note: 'Barrido de paso bajo' }, DURATION);
    expect(edited.patch.marks![0].end).toBe(DURATION);
    expect(edited.patch.marks![0].note).toBe('Barrido de paso bajo');
    expect(edited.proposedLabel).toBeNull();
  });

  it('editar una marca que no existe no cambia nada', () => {
    expect(updateMark(record(), 'inexistente', { note: 'x' }, DURATION).patch).toEqual({});
  });

  it('rechaza pasar del tope de marcas', () => {
    let current = record();
    for (let i = 0; i < MAX_MARKS; i++) current = { ...current, ...addMark(current, createMark('loops', i * 0.1, i * 0.1 + 0.05, DURATION)).patch } as ReviewRecord;
    expect(() => addMark(current, createMark('loops', 1, 2, DURATION))).toThrow(/200/);
  });

  it('permite solapamientos: un tramo puede llevar dos herramientas a la vez', () => {
    let current = record();
    current = { ...current, ...addMark(current, createMark('reversa', 5, 9, DURATION)).patch } as ReviewRecord;
    current = { ...current, ...addMark(current, createMark('filtros', 6, 8, DURATION)).patch } as ReviewRecord;
    current = { ...current, ...addMark(current, createMark('reversa', 7, 10, DURATION)).patch } as ReviewRecord;
    expect(current.marks).toHaveLength(3);
    expect(marksFor(current, 'reversa')).toHaveLength(2);
  });

  it('filtra las marcas de una herramienta', () => {
    let current = record();
    current = { ...current, ...addMark(current, createMark('loops', 1, 2, DURATION)).patch } as ReviewRecord;
    current = { ...current, ...addMark(current, createMark('reversa', 3, 4, DURATION)).patch } as ReviewRecord;
    expect(marksFor(current, 'loops')).toHaveLength(1);
    expect(marksFor(record(), 'loops')).toEqual([]);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run tests/marks.test.ts`
Expected: FAIL — `Failed to resolve import "../services/marks"`.

- [ ] **Step 3: Crear `services/marks.ts`**

```ts
/**
 * Marcas del profesor sobre el audio: dónde ocurre cada herramienta de la rúbrica.
 *
 * Las operaciones devuelven el parche completo del registro en vez de mutarlo, para que la marca y
 * la etiqueta que propone viajen en un solo `onChange`: así el registro nunca queda a medias entre
 * dos escrituras y la cola de guardado (services/save-queue.ts) escribe una vez.
 */
import type { ToolId } from './scoring/rubric';
import type { EffectLabels, ReviewRecord } from './review';

export interface AudioMark {
  id: string;
  effect: ToolId;
  start: number;
  end: number;
  note: string;
  createdAt: string;
}

/** Por debajo de esto una marca no señala nada: es un clic accidental. */
export const MIN_MARK_SECONDS = 0.05;
export const MAX_MARKS = 200;
export const MAX_NOTE = 2000;

/** Color por herramienta. Nunca es la única señal: cada marca lleva además su nombre escrito. */
export const EFFECT_COLOR: Record<ToolId, string> = {
  pitch_shift: 'rgba(199,235,153,.34)',
  time_stretch: 'rgba(228,176,123,.34)',
  reversa: 'rgba(129,212,250,.34)',
  filtros: 'rgba(206,147,216,.34)',
  loops: 'rgba(255,213,79,.34)',
};

export interface MarkPatch { patch: Partial<ReviewRecord>; proposedLabel: ToolId | null }

const clampRange = (start: number, end: number, duration: number) => {
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('La marca necesita un inicio y un final válidos.');
  const limit = Math.max(Number.isFinite(duration) ? duration : 0, MIN_MARK_SECONDS);
  const lo = Math.min(start, end), hi = Math.max(start, end);
  const s = Math.min(Math.max(0, lo), limit - MIN_MARK_SECONDS);
  const e = Math.min(Math.max(s + MIN_MARK_SECONDS, hi), limit);
  return { start: +s.toFixed(3), end: +e.toFixed(3) };
};

const sorted = (marks: AudioMark[]) => [...marks].sort((a, b) => a.start - b.start || a.effect.localeCompare(b.effect));

export const createMark = (effect: ToolId, start: number, end: number, duration: number): AudioMark => ({
  id: crypto.randomUUID(), effect, ...clampRange(start, end, duration), note: '', createdAt: new Date().toISOString(),
});

export const marksFor = (record: ReviewRecord, effect: ToolId): AudioMark[] => (record.marks ?? []).filter(m => m.effect === effect);

export const addMark = (record: ReviewRecord, mark: AudioMark): MarkPatch => {
  const current = record.marks ?? [];
  if (current.length >= MAX_MARKS) throw new Error(`Una muestra admite como mucho ${MAX_MARKS} marcas. Borra alguna antes de añadir otra.`);
  const marks = sorted([...current, mark]);
  // Solo se propone cuando la herramienta seguía pendiente: una decisión ya tomada es del profesor.
  const propose = record.labels[mark.effect] === 'unknown';
  return {
    patch: propose ? { marks, labels: { ...record.labels, [mark.effect]: 'present' } as EffectLabels } : { marks },
    proposedLabel: propose ? mark.effect : null,
  };
};

export const updateMark = (record: ReviewRecord, id: string, changes: Partial<Pick<AudioMark, 'start' | 'end' | 'note'>>, duration: number): MarkPatch => {
  const current = record.marks ?? [];
  const target = current.find(m => m.id === id);
  if (!target) return { patch: {}, proposedLabel: null };
  const range = changes.start !== undefined || changes.end !== undefined
    ? clampRange(changes.start ?? target.start, changes.end ?? target.end, duration)
    : { start: target.start, end: target.end };
  const note = changes.note !== undefined ? changes.note.slice(0, MAX_NOTE) : target.note;
  return { patch: { marks: sorted(current.map(m => m.id === id ? { ...m, ...range, note } : m)) }, proposedLabel: null };
};

/** Borrar quita evidencia, no una decisión: la etiqueta no se toca nunca. */
export const removeMark = (record: ReviewRecord, id: string): MarkPatch =>
  ({ patch: { marks: (record.marks ?? []).filter(m => m.id !== id) }, proposedLabel: null });
```

- [ ] **Step 4: Añadir el campo a `ReviewRecord`**

En `services/review.ts`, añadir el import de tipo (circular pero solo de tipos, se borra al compilar) junto a los demás imports:

```ts
import type { AudioMark } from './marks';
```

Y dentro de `interface ReviewRecord`, justo antes de `ai?: AudioEvaluation;`:

```ts
  /** Dónde ocurre cada herramienta, marcado por el profesor sobre la onda. */
  marks?: AudioMark[];
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `npx vitest run tests/marks.test.ts && npm run typecheck`
Expected: PASS, 13 pruebas; typecheck sin errores.

- [ ] **Step 6: Commit**

```bash
git add services/marks.ts services/review.ts tests/marks.test.ts
git commit -m "Marcas del profesor sobre el audio: tipo, invariantes y operaciones"
```

---

### Task 2: Las marcas viajan en la exportación

**Files:**
- Modify: `services/library-schema.ts` (dentro de `ReviewSchema`)
- Test: `tests/marks-schema.test.ts`

**Interfaces:**
- Consumes: `AudioMark` (Task 1), `exportDataset` / `parseDataset` de `services/library.ts`.
- Produces: nada nuevo; `ReviewSchema` acepta y conserva `marks`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/marks-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { exportDataset, parseDataset } from '../services/library';
import { addMark, createMark } from '../services/marks';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const DURATION = 20;
const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000 * DURATION)], 48000))!);
const record = (): ReviewRecord => createReview('a'.repeat(64), 'pieza.wav', features);
const withMark = (): ReviewRecord => {
  const base = record();
  const mark = { ...createMark('reversa', 12, 18, DURATION), note: 'Cola invertida antes del cambio' };
  return { ...base, ...addMark(base, mark).patch } as ReviewRecord;
};

describe('Marcas en la colección exportada', () => {
  it('sobreviven a una vuelta completa', () => {
    const restored = parseDataset(exportDataset([withMark()]))[0];
    expect(restored.marks).toHaveLength(1);
    expect(restored.marks![0]).toMatchObject({ effect: 'reversa', start: 12, end: 18, note: 'Cola invertida antes del cambio' });
  });

  it('una colección anterior a las marcas sigue siendo válida', () => {
    const legacy = JSON.parse(exportDataset([record()]));
    delete legacy.records[0].marks;
    expect(parseDataset(JSON.stringify(legacy))[0].marks).toBeUndefined();
  });

  it('rechaza una marca cuyo final no va después del inicio', () => {
    const bad = JSON.parse(exportDataset([withMark()]));
    bad.records[0].marks[0].end = bad.records[0].marks[0].start;
    expect(() => parseDataset(JSON.stringify(bad))).toThrow();
  });

  it('rechaza una herramienta inventada', () => {
    const bad = JSON.parse(exportDataset([withMark()]));
    bad.records[0].marks[0].effect = 'autotune';
    expect(() => parseDataset(JSON.stringify(bad))).toThrow();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run tests/marks-schema.test.ts`
Expected: FAIL — `expected undefined to have a length of 1` (zod descarta el campo desconocido).

- [ ] **Step 3: Añadir `marks` al esquema**

En `services/library-schema.ts`, junto a las demás constantes de la cabecera (después de `const evidence = ...`):

```ts
const marks = z.array(z.object({
  id: z.string().min(1).max(64),
  effect: z.enum(['pitch_shift', 'time_stretch', 'reversa', 'filtros', 'loops']),
  start: nonnegative,
  end: nonnegative,
  note: z.string().max(2000),
  createdAt: z.string().datetime(),
}).refine(m => m.end > m.start, 'El final de una marca va después de su inicio')).max(200);
```

Y dentro de `ReviewSchema`, después de la línea `overprocessing: ...` / `extra: label,`:

```ts
  // Opcional: las colecciones anteriores a las marcas siguen siendo válidas.
  marks: marks.optional(),
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npx vitest run tests/marks-schema.test.ts && npm test`
Expected: PASS, 4 pruebas nuevas; el resto de la batería sigue en verde.

- [ ] **Step 5: Commit**

```bash
git add services/library-schema.ts tests/marks-schema.test.ts
git commit -m "Las marcas viajan en la colección exportada sin romper las anteriores"
```

---

### Task 3: Las marcas mandan sobre el texto libre

**Files:**
- Modify: `services/evidence.ts:83-92` (bloque «Anotado por el profesor»)
- Test: `tests/marks-evidence.test.ts`

**Interfaces:**
- Consumes: `marksFor` (Task 1); `buildEvidence(record, rubric, audience)` existente.
- Produces: ítems de evidencia con `id` con prefijo `mark-<markId>`, que `AnalysisView` (Task 5) excluye de los marcadores de solo lectura.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/marks-evidence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildEvidence } from '../services/evidence';
import { addMark, createMark } from '../services/marks';
import { createReview, type ReviewRecord } from '../services/review';
import { extractFeatures } from '../services/audio/features';
import { decodePcm, encodeWav16 } from '../services/audio/wav';

const DURATION = 20;
const features = extractFeatures(decodePcm(encodeWav16([new Float32Array(48000 * DURATION)], 48000))!);
const base = (): ReviewRecord => createReview('b'.repeat(64), 'pieza.wav', features);

describe('Evidencias a partir de marcas', () => {
  it('usa las marcas en lugar del texto cuando las hay', () => {
    let record = { ...base(), evidence: { ...base().evidence, reversa: '0:02–0:03 escrito a mano' } } as ReviewRecord;
    const mark = { ...createMark('reversa', 12, 18, DURATION), note: 'Cola invertida' };
    record = { ...record, ...addMark(record, mark).patch } as ReviewRecord;
    const items = buildEvidence(record).filter(i => i.effect === 'reversa' && i.source === 'profesor');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: `mark-${mark.id}`, time: 12, end: 18, detalle: 'Cola invertida' });
  });

  it('sin marcas sigue parseando los tiempos del texto', () => {
    const record = { ...base(), labels: { ...base().labels, reversa: 'present' as const }, evidence: { ...base().evidence, reversa: '0:12–0:18 cola invertida' } };
    const items = buildEvidence(record).filter(i => i.effect === 'reversa' && i.source === 'profesor');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'teacher-reversa-0', time: 12, end: 18 });
  });

  it('la primera marca lleva los puntos y las siguientes no', () => {
    let record = base();
    record = { ...record, ...addMark(record, createMark('reversa', 2, 4, DURATION)).patch } as ReviewRecord;
    record = { ...record, ...addMark(record, createMark('reversa', 9, 11, DURATION)).patch } as ReviewRecord;
    const items = buildEvidence(record).filter(i => i.effect === 'reversa' && i.source === 'profesor');
    expect(items).toHaveLength(2);
    expect(items[1].puntos).toBeNull();
    expect(items[0].puntos).not.toBeNull();
  });

  it('una marca sin comentario cae en el detalle por defecto', () => {
    let record = base();
    record = { ...record, ...addMark(record, createMark('loops', 5, 7, DURATION)).patch } as ReviewRecord;
    const item = buildEvidence(record).find(i => i.effect === 'loops' && i.source === 'profesor');
    expect(item?.detalle).toBe('Uso confirmado');
  });

  it('el estudiante no ve las marcas hasta que se publica la revisión', () => {
    let record = base();
    record = { ...record, ...addMark(record, createMark('reversa', 12, 18, DURATION)).patch } as ReviewRecord;
    expect(buildEvidence(record, undefined, 'student').some(i => i.source === 'profesor')).toBe(false);
    expect(buildEvidence({ ...record, published: true }, undefined, 'student').some(i => i.id.startsWith('mark-'))).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run tests/marks-evidence.test.ts`
Expected: FAIL — el primer test recibe el ítem `teacher-reversa-0` en vez de `mark-…`.

- [ ] **Step 3: Dar prioridad a las marcas**

En `services/evidence.ts`, añadir al bloque de imports:

```ts
import { marksFor } from './marks';
```

Y sustituir el cuerpo del bucle `if (showsTeacher) for (const effect of EFFECTS) { … }` (líneas 83-92) por:

```ts
  if (showsTeacher) for (const effect of EFFECTS) {
    const label = record.labels[effect.id];
    if (label === 'unknown') continue;
    const line = score.creative.lines.find((l) => l.criterio.toLowerCase() === effect.label.toLowerCase());
    const criterio = `${effect.label} ${label === 'present' ? 'confirmado' : 'ausente'}`;
    const detalle = record.evidence[effect.id]?.trim() || (label === 'present' ? 'Uso confirmado' : 'Ausencia confirmada');
    const marks = marksFor(record, effect.id);
    // Las marcas mandan; el texto libre solo se parsea cuando no hay ninguna.
    if (marks.length) {
      marks.forEach((m, i) => items.push({ id: `mark-${m.id}`, time: m.start, end: m.end, criterio, source: 'profesor', detalle: m.note.trim() || detalle, puntos: i === 0 ? line?.puntos ?? 0 : null, effect: effect.id }));
      continue;
    }
    const ranges = parseTimeRanges(record.evidence[effect.id] || '');
    if (ranges.length) ranges.forEach((r, i) => items.push({ id: `teacher-${effect.id}-${i}`, time: r.start, end: r.end, criterio, source: 'profesor', detalle, puntos: i === 0 ? line?.puntos ?? 0 : null, effect: effect.id }));
    else items.push({ id: `teacher-${effect.id}`, criterio, source: 'profesor', detalle, puntos: line?.puntos ?? 0, effect: effect.id });
  }
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npx vitest run tests/marks-evidence.test.ts && npm test`
Expected: PASS, 5 pruebas nuevas; `tests/evidence-engines.test.ts` y `tests/evidence-audience.test.ts` siguen en verde.

- [ ] **Step 5: Commit**

```bash
git add services/evidence.ts tests/marks-evidence.test.ts
git commit -m "Las marcas del profesor tienen prioridad sobre las evidencias escritas"
```

---

### Task 4: Reproductor con regiones editables y zoom

**Files:**
- Modify: `components/AudioPlayer.tsx`

**Interfaces:**
- Consumes: `MIN_MARK_SECONDS` de `services/marks.ts` (Task 1).
- Produces:
  - `export interface Marker { id?: string; start: number; end: number; color: string; label: string; editable?: boolean }`
  - Props nuevas: `markEditing?: { color: string } | null`, `onMarkCreate?: (start: number, end: number) => void`, `onMarkUpdate?: (id: string, start: number, end: number) => void`, `zoomable?: boolean`.

**Nota de verificación:** este componente depende de wavesurfer y del DOM, y el proyecto no tiene pruebas de componentes. Su puerta es `npm run typecheck && npm run build` más la batería unitaria en verde; su comportamiento lo cubre la Task 6. No se declara probado hasta que la Task 6 esté verde.

- [ ] **Step 1: Ampliar el tipo `Marker` y las props**

En `components/AudioPlayer.tsx`, sustituir la línea 11:

```ts
export interface Marker { id?: string; start: number; end: number; color: string; label: string; editable?: boolean }
```

Y dentro de `interface AudioPlayerProps`, añadir:

```ts
  /** Con valor, arrastrar sobre la onda crea una marca de ese color. Solo el profesor. */
  markEditing?: { color: string } | null;
  onMarkCreate?: (start: number, end: number) => void;
  onMarkUpdate?: (id: string, start: number, end: number) => void;
  /** Muestra el control de zoom: sin él no se puede marcar con precisión en un archivo largo. */
  zoomable?: boolean;
```

Añadir el import:

```ts
import { MIN_MARK_SECONDS } from '../services/marks';
```

- [ ] **Step 2: Recoger las props y mantener las llamadas en refs**

Justo después de la línea `const onTimeRef = useRef(onTime); onTimeRef.current = onTime;`, añadir:

```ts
  const onCreateRef = useRef(onMarkCreate); onCreateRef.current = onMarkCreate;
  const onUpdateRef = useRef(onMarkUpdate); onUpdateRef.current = onMarkUpdate;
  /** Verdadero mientras el efecto de sincronización crea regiones, para no confundirlas con un arrastre. */
  const syncing = useRef(false);
  const [zoom, setZoom] = useState(0); // 0 = ajustar al ancho
```

Y cambiar la firma del componente para desestructurar las props nuevas:

```ts
const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, features, extraMarkers = [], seekRef, onTime, markEditing = null, onMarkCreate, onMarkUpdate, zoomable = false }) => {
```

Actualizar `extraKey` para que un cambio de marca repinte las regiones:

```ts
  const extraKey = extraMarkers.map((m) => `${m.id ?? ''}-${m.start.toFixed(3)}-${m.end.toFixed(3)}-${m.editable ? 'e' : 'r'}-${m.label}`).join('|');
```

- [ ] **Step 3: Hacer editables las regiones que lo pidan**

Sustituir el cuerpo del efecto de regiones (líneas 90-101, el que empieza con `regions.clearRegions();`) por:

```ts
    syncing.current = true;
    regions.clearRegions();
    for (const mk of [...buildMarkers(features), ...extraMarkers]) {
      const region = regions.addRegion({ id: mk.id, start: mk.start, end: mk.end, color: mk.color, drag: !!mk.editable, resize: !!mk.editable, minLength: MIN_MARK_SECONDS, content: mk.end - mk.start > 0.5 ? mk.label.split(' · ')[0] : undefined });
      region.on('over', () => setHover(mk.label));
      region.on('leave', () => setHover(''));
      if (mk.editable && mk.id) region.on('update-end', () => onUpdateRef.current?.(mk.id!, region.start, region.end));
      else region.on('click', (e) => { e.stopPropagation(); ws.setTime(Math.max(0, mk.start - 0.5)); void ws.play().catch(() => setError('No se pudo iniciar la reproducción.')); });
    }
    syncing.current = false;
```

El `update-end` solo salta al soltar: arrastrar no dispara una escritura por píxel.

- [ ] **Step 4: Crear marcas arrastrando**

Añadir un efecto nuevo justo debajo del anterior:

```ts
  // Modo marcado: arrastrar sobre la onda crea una marca. La región provisional se borra y la
  // definitiva la vuelve a pintar el efecto de sincronización desde el estado del registro.
  useEffect(() => {
    const regions = regionsRef.current;
    if (!ready || !regions || !markEditing) return;
    const disable = regions.enableDragSelection({ color: markEditing.color, drag: false, resize: false, minLength: MIN_MARK_SECONDS }, 3);
    const off = regions.on('region-created', (region) => {
      if (syncing.current) return;
      const { start, end } = region;
      region.remove();
      onCreateRef.current?.(start, end);
    });
    return () => { disable(); off(); };
  }, [ready, markEditing]);
```

- [ ] **Step 5: Añadir el zoom**

Añadir otro efecto debajo:

```ts
  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ready || !ws || !zoomable) return;
    const width = waveformRef.current?.clientWidth ?? 0;
    const fit = width && ws.getDuration() ? width / ws.getDuration() : 1;
    ws.zoom(Math.max(1, zoom || fit));
  }, [ready, zoom, zoomable]);
```

Y en el JSX, justo después del `<div ref={waveformRef} … />`, añadir los controles:

```tsx
      {zoomable && <div className="zoom-row">
        <span>Zoom</span>
        {[0, 50, 100, 200, 400].map((level) => (
          <button key={level} type="button" aria-pressed={zoom === level} className={zoom === level ? 'selected' : ''} onClick={() => setZoom(level)}>
            {level === 0 ? 'Ajustar' : `${level} px/s`}
          </button>
        ))}
      </div>}
```

- [ ] **Step 6: Comprobar tipos y compilación**

Run: `npm run typecheck && npm test && npm run build`
Expected: sin errores de tipos, batería unitaria en verde, build correcto.

- [ ] **Step 7: Commit**

```bash
git add components/AudioPlayer.tsx
git commit -m "Reproductor: regiones editables, creación por arrastre y zoom"
```

---

### Task 5: Barra de marcado, lista editable y montaje

**Files:**
- Create: `components/workspace/MarkEditor.tsx`
- Modify: `components/workspace/AnalysisView.tsx`, `components/workspace/ReviewPanel.tsx`, `styles.css`

**Interfaces:**
- Consumes: `AudioMark`, `EFFECT_COLOR`, `createMark`, `addMark`, `updateMark`, `removeMark`, `marksFor` (Task 1); `Marker` (Task 4).
- Produces: `MarkEditor` con las props declaradas en el Step 1.

**Nota de verificación:** misma que la Task 4. Su puerta automática es typecheck + build; el comportamiento lo cubre la Task 6.

- [ ] **Step 1: Crear `components/workspace/MarkEditor.tsx`**

```tsx
import { EFFECTS, type ReviewRecord } from '../../services/review';
import { EFFECT_COLOR, MAX_NOTE, createMark, type AudioMark } from '../../services/marks';
import { formatTimestamp } from '../../services/audio/features';
import type { ToolId } from '../../services/scoring/rubric';
import { MapPin, Play, Plus, Trash2 } from 'lucide-react';

interface Props {
  record: ReviewRecord;
  duration: number;
  /** Herramienta en modo marcado, o null si está desactivado. */
  marking: ToolId | null;
  onMarking: (effect: ToolId | null) => void;
  /** Posición del cursor de reproducción, para «marcar desde aquí». */
  currentTime: number;
  canSeek: boolean;
  onSeek: (time: number) => void;
  onAdd: (mark: AudioMark) => void;
  onUpdate: (id: string, changes: Partial<Pick<AudioMark, 'start' | 'end' | 'note'>>) => void;
  onRemove: (id: string) => void;
}

const labelOf = (effect: ToolId) => EFFECTS.find(e => e.id === effect)?.label ?? effect;

/** Barra de marcado y lista editable. La lista funciona sin ratón y sin audio. */
export default function MarkEditor({ record, duration, marking, onMarking, currentTime, canSeek, onSeek, onAdd, onUpdate, onRemove }: Props) {
  const marks = record.marks ?? [];
  const active: ToolId = marking ?? 'reversa';
  const fromCursor = () => onAdd(createMark(active, currentTime, currentTime + 1, duration));

  return <div className="mark-editor">
    <div className="mark-toolbar">
      <MapPin size={16} />
      <label className="visually-hidden" htmlFor="mark-effect">Herramienta que vas a marcar</label>
      <select id="mark-effect" value={active} onChange={e => onMarking(marking ? e.target.value as ToolId : null)}>
        {EFFECTS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
      </select>
      <button type="button" className={`button ${marking ? 'primary' : 'secondary'}`} aria-pressed={!!marking} onClick={() => onMarking(marking ? null : active)}>
        {marking ? 'Marcando…' : 'Marcar'}
      </button>
      <button type="button" className="button secondary" onClick={fromCursor}><Plus size={14} /> Marcar desde el tiempo actual</button>
      <small className="muted text-small">{marking ? `Arrastra sobre la onda para marcar ${labelOf(active).toLowerCase()}.` : 'Activa «Marcar» y arrastra sobre la onda, o añade la marca desde el cursor y ajusta los tiempos abajo.'}</small>
    </div>

    {marks.length === 0
      ? <p className="muted text-small">Todavía no has marcado nada en este audio.</p>
      : <ul className="mark-list">{marks.map(m => <li key={m.id} className="mark-row">
          <span className="mark-swatch" style={{ background: EFFECT_COLOR[m.effect] }} aria-hidden="true" />
          <b className="mark-effect">{labelOf(m.effect)}</b>
          <label className="visually-hidden" htmlFor={`start-${m.id}`}>Inicio de la marca de {labelOf(m.effect)}</label>
          <input id={`start-${m.id}`} type="number" className="mark-time" min={0} max={duration} step={0.01} value={m.start} onChange={e => onUpdate(m.id, { start: Number(e.target.value) })} />
          <label className="visually-hidden" htmlFor={`end-${m.id}`}>Final de la marca de {labelOf(m.effect)}</label>
          <input id={`end-${m.id}`} type="number" className="mark-time" min={0} max={duration} step={0.01} value={m.end} onChange={e => onUpdate(m.id, { end: Number(e.target.value) })} />
          <span className="mark-range mono">{formatTimestamp(m.start)}–{formatTimestamp(m.end)}</span>
          <input className="mark-note" maxLength={MAX_NOTE} placeholder="Qué se oye aquí…" aria-label={`Comentario de la marca de ${labelOf(m.effect)}`} value={m.note} onChange={e => onUpdate(m.id, { note: e.target.value })} />
          {canSeek && <button type="button" className="icon-button" aria-label={`Escuchar la marca de ${labelOf(m.effect)}`} onClick={() => onSeek(Math.max(0, m.start - 0.3))}><Play size={14} /></button>}
          <button type="button" className="icon-button" aria-label={`Borrar la marca de ${labelOf(m.effect)}`} onClick={() => onRemove(m.id)}><Trash2 size={14} /></button>
        </li>)}</ul>}
  </div>;
}
```

- [ ] **Step 2: Montar el editor en `AnalysisView`**

En `components/workspace/AnalysisView.tsx`, añadir imports:

```ts
import MarkEditor from './MarkEditor';
import { EFFECT_COLOR, addMark, createMark, removeMark, updateMark, type AudioMark, type MarkPatch } from '../../services/marks';
import type { ToolId } from '../../services/scoring/rubric';
```

Y añadir `EFFECTS` al import que ya existe de `../../services/review`.

Añadir estado junto a los demás `useState` del componente:

```ts
  const [marking, setMarking] = useState<ToolId | null>(null);
```

Y limpiarlo al cambiar de muestra: en el `useEffect` que ya hace `setSpectrum(''); setTab('wave'); …`, añadir `setMarking(null);`.

Sustituir el cálculo de `extraMarkers` (línea 35) por este bloque, que separa las marcas editables de las evidencias de solo lectura:

```ts
  const duration = record.features.format.duration;
  // Las marcas se pintan desde el registro, no desde la lista de evidencias: si no, saldrían dos veces.
  const visibleMarks = teacher || record.published ? record.marks ?? [] : [];
  const extraMarkers = useMemo<Marker[]>(() => [
    ...evidence.filter(e => e.time !== undefined && e.source !== 'medido' && !e.id.startsWith('mark-')).map(e => ({ start: e.time!, end: e.end ?? Math.min(duration, e.time! + 0.25), color: SOURCE_COLOR[e.source], label: `${e.criterio} · ${e.source === 'profesor' ? 'profesor' : 'modelo'} · ${fmtRange({ start: e.time!, end: e.end })}` })),
    ...visibleMarks.map(m => ({ id: m.id, start: m.start, end: m.end, color: EFFECT_COLOR[m.effect], editable: teacher, label: `${EFFECTS.find(x => x.id === m.effect)?.label ?? m.effect} · profesor · ${fmtRange({ start: m.start, end: m.end })}` })),
  ], [evidence, duration, visibleMarks, teacher]);
```

Añadir el import de `EFFECTS` a la línea que ya importa de `../../services/review`.

Añadir los tres manejadores, que convierten el parche en un solo `onChange`:

```ts
  const [markNotice, setMarkNotice] = useState('');
  const applyMark = (result: MarkPatch) => {
    if (!Object.keys(result.patch).length) return;
    onChange(result.patch);
    setMarkNotice(result.proposedLabel ? `${EFFECTS.find(e => e.id === result.proposedLabel)?.label} pasa a «presente». Puedes cambiarlo en la revisión.` : '');
  };
  const addMarkHere = (mark: AudioMark) => { try { applyMark(addMark(record, mark)); } catch (e) { setMarkNotice(e instanceof Error ? e.message : 'No se pudo añadir la marca.'); } };
```

`MarkPatch` viene de `services/marks.ts` (Task 1); no lo redeclares aquí.

Pasar las props nuevas al reproductor (línea 44):

```tsx
      {audioUrl ? <AudioPlayer src={audioUrl} features={record.features} extraMarkers={extraMarkers} seekRef={seekRef} onTime={setPlayTime} zoomable={teacher} markEditing={marking ? { color: EFFECT_COLOR[marking] } : null} onMarkCreate={(start, end) => addMarkHere(createMark(marking ?? 'reversa', start, end, duration))} onMarkUpdate={(id, start, end) => applyMark(updateMark(record, id, { start, end }, duration))} /> : <div className="empty-audio">Este registro contiene métricas y etiquetas. Vuelve a subir el audio original para escucharlo; se reconocerá por su huella.</div>}
```

Añadir `createMark` al import de `services/marks`.

Y justo debajo del reproductor, dentro de la misma `<section className="panel signal-panel">`, montar el editor solo para el profesor:

```tsx
      {teacher && <>
        {markNotice && <p className="notice" role="status">{markNotice}</p>}
        <MarkEditor record={record} duration={duration} marking={marking} onMarking={setMarking} currentTime={playTime} canSeek={!!audioUrl} onSeek={seek}
          onAdd={addMarkHere}
          onUpdate={(id, changes) => applyMark(updateMark(record, id, changes, duration))}
          onRemove={id => applyMark(removeMark(record, id))} />
      </>}
```

- [ ] **Step 3: Mostrar el número de marcas en la revisión**

En `components/workspace/ReviewPanel.tsx`, añadir el import:

```ts
import { marksFor } from '../../services/marks';
```

Y en la cabecera de cada fila de herramienta, sustituir `<h4>{effect.label}{!required.has(effect.id) && <small>opcional</small>}</h4>` por:

```tsx
<h4>{effect.label}{!required.has(effect.id) && <small>opcional</small>}{marksFor(record, effect.id).length > 0 && <small className="mark-count">{marksFor(record, effect.id).length} marca(s)</small>}</h4>
```

- [ ] **Step 4: Añadir los estilos**

Añadir al final de `styles.css`:

```css

/* --- Marcado manual sobre la onda --- */
.zoom-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 10px; font-size: 11px; color: var(--muted); }
.zoom-row button { min-height: 32px; padding: 5px 9px; border: 1px solid var(--line); border-radius: 4px; background: #1c241b; color: var(--muted); font-family: var(--mono); font-size: 10px; }
.zoom-row button.selected { background: var(--accent); border-color: var(--accent); color: #182214; }
.mark-editor { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line); }
.mark-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.mark-toolbar select { min-height: 40px; }
.mark-toolbar small { flex: 1 1 220px; }
.mark-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.mark-row { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 5px; background: #1c241b; }
.mark-swatch { width: 11px; height: 11px; border-radius: 3px; flex-shrink: 0; }
.mark-effect { font-size: 11px; min-width: 96px; }
.mark-time { width: 84px; min-height: 36px; font-family: var(--mono); font-size: 11px; }
.mark-range { font-size: 10px; color: var(--muted); }
.mark-note { flex: 1 1 200px; min-height: 36px; font-size: 11px; }
.mark-count { margin-left: 8px; color: var(--accent); }
@media (max-width:650px) {
  .mark-toolbar { gap: 8px; }
  .mark-toolbar .button { flex: 1 1 100%; }
  .mark-row { gap: 7px; }
  .mark-effect { min-width: 0; }
  .mark-note { flex: 1 1 100%; }
}
```

- [ ] **Step 5: Comprobar tipos y compilación**

Run: `npm run typecheck && npm test && npm run build`
Expected: sin errores; batería unitaria en verde; build correcto.

- [ ] **Step 6: Commit**

```bash
git add components/workspace/MarkEditor.tsx components/workspace/AnalysisView.tsx components/workspace/ReviewPanel.tsx styles.css
git commit -m "Barra de marcado, lista editable de marcas y montaje en el análisis"
```

---

### Task 6: Pruebas de navegador y documentación

**Files:**
- Modify: `tests/e2e/workspace.spec.ts`, `README.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la puerta de comportamiento de las tareas 4 y 5.

- [ ] **Step 1: Escribir las pruebas end to end**

Añadir al final de `tests/e2e/workspace.spec.ts`:

```ts
test('el profesor marca sin ratón, la etiqueta se propone y la marca aparece como evidencia', async ({ page }) => {
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();

  await page.getByLabel('Herramienta que vas a marcar').selectOption('reversa');
  await page.getByRole('button', { name: 'Marcar desde el tiempo actual' }).click();

  // La etiqueta pendiente pasa a «presente» y se avisa
  await expect(page.getByRole('status')).toContainText('Reversa pasa a «presente»');
  await expect(page.getByRole('group', { name: 'Revisión de Reversa' }).getByRole('button', { name: 'Presente' })).toHaveAttribute('aria-pressed', 'true');

  // Los tiempos se ajustan con los campos numéricos
  await page.getByLabel('Final de la marca de Reversa').fill('4.5');
  await page.getByLabel('Comentario de la marca de Reversa').fill('Cola invertida');
  await expect(page.locator('.evidence-panel')).toContainText('Cola invertida');

  // Borrar la marca no devuelve la etiqueta a pendiente
  await page.getByRole('button', { name: 'Borrar la marca de Reversa' }).click();
  await expect(page.locator('.mark-list')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Revisión de Reversa' }).getByRole('button', { name: 'Presente' })).toHaveAttribute('aria-pressed', 'true');
});

test('las marcas sobreviven a recargar y el zoom está disponible', async ({ page }) => {
  await page.getByLabel('Subir archivos de audio').setInputFiles(audio());
  await expect(page.getByRole('heading', { name: 'campana_validacion.wav', exact: true })).toBeVisible();
  await page.getByLabel('Herramienta que vas a marcar').selectOption('loops');
  await page.getByRole('button', { name: 'Marcar desde el tiempo actual' }).click();
  await page.getByLabel('Comentario de la marca de Loops').fill('Bucle de dos compases');
  await expect(page.getByRole('button', { name: '200 px/s' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /Biblioteca/ }).first().click();
  await page.getByRole('button', { name: /^campana_validacion/ }).click();
  await expect(page.getByLabel('Comentario de la marca de Loops')).toHaveValue('Bucle de dos compases');
});
```

- [ ] **Step 2: Ejecutar y comprobar que pasan**

Run: `npx playwright test workspace.spec.ts`
Expected: PASS, las 14 pruebas anteriores más las 2 nuevas.

Si el segundo test falla por tiempos de guardado, es que la cola de `services/save-queue.ts` aún no ha vaciado: añadir `await page.waitForTimeout(600)` antes de `page.reload()` y dejar el motivo escrito en un comentario del test.

- [ ] **Step 3: Documentar la función**

En `README.md`, en la lista de prestaciones, añadir después de la línea que empieza por `- **Modelo local:**`:

```markdown
- **Marcado manual (profesor):** arrastra sobre la forma de onda —o marca desde el cursor, sin ratón— para señalar dónde ocurre cada herramienta de la rúbrica, con un comentario por marca. La primera marca de una herramienta pendiente la propone como «presente»; borrarla no cambia la etiqueta. Las marcas se pintan en el reproductor, encabezan la lista de evidencias, viajan en la colección exportada y solo llegan al estudiante cuando la revisión se publica. Zoom de hasta 400 px/s para marcar con precisión.
```

- [ ] **Step 4: Verificación completa**

Run: `npm run typecheck && npm test && npm run build && npx playwright test`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/workspace.spec.ts README.md
git commit -m "Pruebas de navegador del marcado manual y documentación"
```

---

## Notas para quien ejecute

- **No inventes campos nuevos en `ReviewRecord`.** Todo lo que necesita el marcado cabe en `marks`.
- **No toques `changesTraining`.** Marcar no debe caducar el modelo local; la etiqueta propuesta sí lo hace, y eso es correcto porque cambia lo que se entrena.
- **No conviertas las marcas en entrada del modelo local.** Eso es el bloque D y depende de una medición que está en curso: el resultado preliminar apunta a que la unidad útil para entrenar ronda los 8 segundos, no los milisegundos.
- Si una prueba de navegador resulta frágil, **dilo en el test** con un comentario; no la borres ni la marques como omitida en silencio.
