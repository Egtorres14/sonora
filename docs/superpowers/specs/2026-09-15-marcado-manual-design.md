# Marcado manual de puntos en el audio (bloque B)

Fecha: 2026-09-15. Estado: diseño aprobado en conversación; pendiente de plan de implementación.

Contexto: es el segundo bloque de la descomposición acordada el 2026-09-15. El bloque A (volver a la
zona de carga, rendimiento de la biblioteca y los arreglos de la auditoría) está implementado. Los
bloques C (almacenamiento en git) y D (entrenar con las anotaciones y ver la mejora) se diseñarán
después, y D depende de este.

## Objetivo

El profesor marca sobre la forma de onda **dónde** ocurre cada herramienta de la rúbrica, con un
comentario, y esas marcas pasan a ser la evidencia localizada que sostiene la nota. Hoy los tiempos
se escriben a mano como texto («0:12–0:18») y `services/evidence.ts` los extrae con una expresión
regular: funciona, pero obliga a leer el reloj del reproductor y transcribirlo.

## Qué no entra

- **El estudiante no marca.** Ve las marcas del profesor en su informe, y solo cuando la revisión
  está publicada, igual que el resto de decisiones.
- **No hay marcas de problemas técnicos** (clic, saturación, silencio, discontinuidad). Esas las
  mide el DSP y siguen siendo de solo lectura: mezclar «lo que mide el archivo» con «lo que decide
  el profesor» rompería la distinción que sostiene toda la interfaz.
- **No hay categoría libre.** Los efectos extra ya puntúan como bonus por su propio campo.
- **Nada de IA ni de entrenamiento.** Las marcas no se envían a ningún proveedor ni alimentan al
  modelo local en este bloque. Eso es el bloque D.
- **No se entrena por tramos.** El modelo local aprende de descriptores globales del archivo
  (`services/learning/descriptors.ts`); cambiar eso es un rediseño del modelo, no parte de esto.

## Decisiones

| Decisión | Resuelto |
|---|---|
| Qué se puede marcar | Solo las cinco herramientas de la rúbrica: `pitch_shift`, `time_stretch`, `reversa`, `filtros`, `loops`. |
| Marca y etiqueta | Crear la **primera** marca de una herramienta cuya etiqueta esté en «pendiente» la propone como «presente» y lo avisa. Si ya estaba decidida, no se toca. |
| Borrar marcas | Nunca cambia la etiqueta. Marcar propone una vez; a partir de ahí la etiqueta es del profesor y solo él la mueve desde el panel de revisión. Borrar quita evidencia, no una decisión. |
| Texto por herramienta | Se queda. Si una herramienta tiene marcas, los tiempos salen de ellas; si no tiene ninguna, se sigue parseando el texto como hoy. |
| Zoom | **Dentro del alcance.** En 60 s sobre 1.000 px un píxel son 60 ms: sin zoom el marcado nace impreciso y la función no sirve. |
| Marca mínima | 50 ms, con umbral de arrastre de 3 px para que un clic accidental no cree una marca. |
| Solapamientos | Permitidos, entre herramientas distintas y dentro de la misma. Un tramo puede tener reversa y filtros a la vez. |
| Sin audio | La lista de marcas con campos numéricos funciona igual. Solo falta la onda. |

## Datos

Nuevo `services/marks.ts` y un campo en `ReviewRecord`:

```ts
export interface AudioMark {
  id: string;        // crypto.randomUUID()
  effect: ToolId;    // una de las cinco herramientas
  start: number;     // segundos
  end: number;       // segundos, siempre > start
  note: string;      // comentario del profesor, puede ir vacío
  createdAt: string;
}
```

`ReviewRecord.marks?: AudioMark[]` — array plano, ordenado por `start` y luego por `effect`,
**opcional** para que los registros y las colecciones ya existentes sigan siendo válidos sin
migración.

Invariantes, garantizadas al crear y al editar, nunca por la interfaz:

- `0 ≤ start`, `end ≤ features.format.duration`, `end − start ≥ 0.05`.
- Máximo 200 marcas por registro (`MAX_MARKS`). Al llegar al tope se avisa y no se añade.
- `note` de 2.000 caracteres como máximo.

El módulo expone operaciones que devuelven **el parche completo** para un solo `onChange`, de modo
que registro y etiquetas nunca queden a medias y la cola de guardado escriba una vez:

```ts
export interface MarkPatch { patch: Partial<ReviewRecord>; proposedLabel: ToolId | null }
export const createMark  = (effect: ToolId, start: number, end: number, duration: number) => AudioMark;
export const addMark     = (record: ReviewRecord, mark: AudioMark) => MarkPatch;  // puede proponer etiqueta
export const updateMark  = (record: ReviewRecord, id: string, changes: Partial<Pick<AudioMark, 'start' | 'end' | 'note'>>, duration: number) => MarkPatch;
export const removeMark  = (record: ReviewRecord, id: string) => MarkPatch;       // proposedLabel siempre null
export const marksFor    = (record: ReviewRecord, effect: ToolId) => AudioMark[];
```

`proposedLabel` es lo que la interfaz usa para mostrar el aviso; la propuesta ya viene aplicada
dentro de `patch.labels`.

**El marcado no caduca el modelo local.** `changesTraining` (`services/review.ts`) no incluye
`marks`, porque el modelo aprende de etiquetas globales. Lo que sí caduca el modelo es la etiqueta
propuesta, y eso es correcto: ha cambiado lo que se entrena.

## Esquema de exportación

En `services/library-schema.ts`, dentro de `ReviewSchema`:

```ts
marks: z.array(z.object({
  id: z.string().min(1).max(64),
  effect: z.enum(['pitch_shift', 'time_stretch', 'reversa', 'filtros', 'loops']),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().nonnegative(),
  note: z.string().max(2000),
  createdAt: z.string().datetime(),
}).refine(m => m.end > m.start, 'El final de una marca va después de su inicio')).max(200).optional(),
```

`DatasetSchema.version` sigue en **1**: el campo es opcional, una colección antigua valida igual y
una versión antigua de la app ignora el campo al leer una nueva. El esquema no comprueba que
`end ≤ duración`, que es trabajo de `services/marks.ts` al crear: rechazar una colección entera por
una marca desbordada sería desproporcionado, y una marca larga de más se dibuja recortada.

Como las marcas viajan dentro del registro, entran solas en `exportDataset` y, por tanto, en el
flujo de contribuciones (`scripts/contrib/ingest-issue.ts`), que valida con el mismo esquema.

## Interfaz

### Reproductor (`components/AudioPlayer.tsx`)

El tipo `Marker` gana `id` y `editable`; una región editable se crea con `drag` y `resize` activos y
avisa de su nuevo tramo en `update-end` (no en `update`, que dispara en cada píxel del arrastre).

```ts
export interface Marker { id?: string; start: number; end: number; color: string; label: string; editable?: boolean }
```

Props nuevas:

- `markEditing?: { effect: ToolId; color: string } | null` — con valor, se llama a
  `regions.enableDragSelection({ color }, threshold)` y arrastrar crea una marca de esa herramienta;
  a `null` se desactiva (la función que devuelve `enableDragSelection` se guarda para revertirlo).
- `onMarkCreate?: (start: number, end: number) => void`
- `onMarkUpdate?: (id: string, start: number, end: number) => void`
- `zoomable?: boolean` — muestra el control de zoom.

Zoom con `ws.zoom(minPxPerSec)` sobre los valores `[ajustar, 50, 100, 200, 400]` px/s, donde
«ajustar» es `ancho del contenedor / duración` (no cero: `zoom(0)` no es un nivel válido), con
`autoScroll` activo (ya es el valor por defecto) para que el cursor no se pierda al reproducir. Los
controles son botones y un `input[type=range]`, accesibles con teclado.

### Barra de marcado y lista (`components/workspace/MarkEditor.tsx`, nuevo)

Solo para el profesor, encima de la onda:

- Selector de herramienta activa y botón **Marcar** que activa o desactiva el modo. Mientras está
  activo se explica en una línea que arrastrando sobre la onda se crea una marca.
- **Marcar desde el tiempo actual**: crea una marca de 1 s desde la posición del cursor de
  reproducción, recortada al final del archivo (y desplazada hacia atrás si no cabe el mínimo de
  50 ms). Es el camino sin ratón, y el que funciona en un registro sin audio, donde el cursor está
  en 0 y la marca se ajusta después con los campos numéricos.

Debajo, la lista de marcas ordenada por tiempo: herramienta, inicio y fin como campos numéricos
editables (`step` 0,01), comentario, botón para escuchar desde ahí y botón para borrar. La lista se
muestra aunque no haya audio; entonces solo desaparece el botón de escuchar.

Las cinco herramientas tienen color propio (`EFFECT_COLOR` en `services/marks.ts`), translúcido
sobre el verde de la onda. El color nunca es la única señal: cada región lleva su etiqueta de texto
y la lista repite la herramienta escrita.

### Panel de revisión (`components/workspace/ReviewPanel.tsx`)

Cada fila de herramienta muestra cuántas marcas tiene, para que el profesor vea desde la revisión
dónde ya hay evidencia localizada. El campo de texto de evidencia se queda como está.

### Análisis (`components/workspace/AnalysisView.tsx`)

Las marcas se pintan desde `record.marks`, no desde la lista de evidencias, para no dibujarlas dos
veces: `extraMarkers` excluye los ítems cuyo `id` empieza por `mark-`. Visibilidad coherente con lo
ya implementado en el bloque A:

```ts
const visibleMarks = teacher || record.published ? record.marks ?? [] : [];
```

y `editable: teacher`.

## Evidencias

En `services/evidence.ts`, dentro del bloque «Anotado por el profesor», para cada herramienta
etiquetada:

1. Si tiene marcas, cada una produce un ítem con `id: 'mark-<markId>'`, su tramo, el comentario de
   la marca como `detalle` y `effect`.
2. Si no tiene ninguna, se parsea `record.evidence[effect]` como hasta ahora.
3. Si no hay ni marcas ni tiempos en el texto, se mantiene el ítem sin tiempo actual.

El reparto de puntos no cambia: la **primera** evidencia de una herramienta lleva los puntos de su
línea en la rúbrica y las siguientes van con `puntos: null`. La nota sigue calculándose en
`calculateReview` a partir de las etiquetas, no de las marcas.

## Pruebas

**Unitarias** (vitest), escritas antes que el código:

- `tests/marks.test.ts` — recorte a la duración, mínimo de 50 ms, tope de 200, orden estable,
  parches de alta, edición y borrado; la etiqueta se propone solo cuando estaba pendiente y solo en
  la primera marca; borrar la última marca deja la etiqueta intacta.
- Ampliación de las evidencias — las marcas mandan sobre el texto; sin marcas, el parseo de
  «0:12–0:18» sigue funcionando; los ítems de marca llevan el prefijo `mark-`; el estudiante no ve
  marcas hasta que la revisión se publica.
- Ampliación de la biblioteca — exportar e importar conserva las marcas; una colección sin el campo
  sigue siendo válida; una marca con `end ≤ start` se rechaza.

**De navegador** (Playwright):

- El profesor arrastra sobre la onda, aparece la marca en la lista, la etiqueta pasa a «Presente»
  con su aviso y la evidencia aparece con su tramo.
- Camino sin ratón: «Marcar desde el tiempo actual», editar inicio y fin en los campos numéricos y
  borrar.
- El estudiante no ve las marcas hasta que el profesor publica.

El arrastre sobre la onda depende de coordenadas del lienzo y puede resultar frágil en CI. Si lo es,
la prueba de navegador se queda con el camino sin ratón y el arrastre se cubre probando el
manejador `onMarkCreate` por unidad; se dirá en el propio test, no se borrará la cobertura en
silencio.

## Archivos

| Archivo | Cambio |
|---|---|
| `services/marks.ts` | Nuevo: tipo, invariantes, operaciones, colores por herramienta. |
| `services/review.ts` | Campo `marks?` en `ReviewRecord`. |
| `services/library-schema.ts` | `marks` opcional en `ReviewSchema`. |
| `services/evidence.ts` | Las marcas tienen prioridad sobre el texto libre. |
| `components/AudioPlayer.tsx` | Regiones editables, creación por arrastre y zoom. |
| `components/workspace/MarkEditor.tsx` | Nuevo: barra de marcado y lista editable. |
| `components/workspace/AnalysisView.tsx` | Monta el editor, calcula las marcas visibles, evita el doble dibujo. |
| `components/workspace/ReviewPanel.tsx` | Número de marcas por herramienta. |
| `styles.css` | Estilos del editor, la lista y el control de zoom. |
| `tests/marks.test.ts` y ampliaciones | Cobertura descrita arriba. |

## Riesgos y límites

- **Las marcas no mejoran hoy al modelo local.** Aprende de descriptores globales del archivo, así
  que un tramo marcado no le dice nada que no supiera. Este bloque construye el dato; que sirva para
  entrenar es la decisión del bloque D, y puede exigir entrenar por segmentos.
- **Zoom y regiones en pantallas pequeñas.** El marcado por arrastre en móvil será incómodo aunque
  funcione; el camino sin ratón es la alternativa real, no un añadido de accesibilidad.
- **Coste de dibujar muchas regiones.** El reproductor ya limita los marcadores medidos (100 clics,
  50 saturaciones, 20 silencios); el tope de 200 marcas mantiene el orden de magnitud.
- **Dos sitios para la misma evidencia.** Texto y marcas conviven por compatibilidad. Si con el uso
  el texto queda vacío en todas partes, retirarlo será un cambio posterior y pequeño.
