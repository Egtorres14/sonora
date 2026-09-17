# Migración de la versión de características

Fecha: 2026-09-16. Estado: diseño aprobado en conversación; pendiente de plan de implementación.

## Problema

`FEATURES_VERSION` (`services/audio/features.ts`, hoy `2.1.0`) no ha cambiado nunca, y el día que
cambie destruye los datos: el esquema de importación exige `z.literal(FEATURES_VERSION)` en dos
sitios, `describeAudio` lanza con cualquier otra versión y `predictLocalModel` rechaza un modelo con
otros descriptores. Consecuencia de subir la versión sin más:

- ninguna colección exportada vuelve a importarse (`parseDataset`), incluidas las contribuidas por
  el flujo de issues, que por diseño no traen audio;
- `public/corpus/coleccion.json` deja de validar y la vista Muestras y el entrenamiento en CI se rompen;
- el entrenamiento local falla entero en cuanto hay un registro antiguo, porque `validateSamples`
  llama a `describeAudio` sobre todos.

El bloque D va a exigir cambiar los descriptores (loops por ventanas). Este trabajo deja el mecanismo
listo **sin cambiar la versión ahora**.

## Decisiones

| Decisión | Resuelto |
|---|---|
| Registros sin audio en versión antigua | **Se conservan**: puntuables (nota, etiquetas, evidencias) pero excluidos del entrenamiento, con un contador visible. No se pierde nada. |
| Qué versiones acepta el esquema | Misma versión mayor que el código y versión menor ≤ la actual. `2.0.0` entra, `1.9.0` y `3.0.0` no. |
| Significado de cada número | **Mayor**: cambia la forma (campos que desaparecen o cambian de tipo). **Menor**: campos nuevos, que entran como opcionales en el esquema. **Parche**: mismos campos, recalculados con otro algoritmo. |
| Reanálisis | Oportunista al abrir (el análisis ya se hace y hoy se tira) y por lotes desde Modelo local. Solo registros con audio guardado. |
| Corpus publicado | Una prueba falla si `coleccion.json` o `modelo.json` no van en la versión del código. Regenerar el corpus es parte de cualquier cambio de versión. |
| Funciones de migración por versión | No, por ahora. Solo sirven para renombrados; el caso real es medir algo nuevo. Si un día hace falta, encaja como paso previo al reanálisis sin cambiar nada de esto. |

## Componentes

### `services/audio/version.ts` (nuevo)

```ts
export const parseFeatureVersion = (v: string) => { major, minor, patch } | null;
/** ¿Puede este código leer un registro con esta versión? Misma mayor, menor ≤ actual. */
export const acceptsFeatureVersion = (v: string): boolean;
/** ¿Está el registro en la versión actual? Solo entonces es entrenable. */
export const isCurrentFeatures = (f: { version: string }): boolean;
```

`FEATURES_VERSION` sigue en `features.ts`; este módulo solo lee.

### Esquema (`services/library-schema.ts`)

`version: z.string().refine(acceptsFeatureVersion)` en `features` y en `features.analysis`.
Regla para el futuro, escrita en la cabecera de `features.ts`: un campo añadido en una versión menor
es `.optional()` en el esquema, y el código que lo lee lo trata como ausente en registros antiguos.

### Entrenamiento (`services/learning/model.ts`)

```ts
/** Separa lo entrenable de lo que necesita reanálisis. Lo usan la app y CI. */
export const splitByFeatureVersion = <T extends { features: { version: string } }>(records: T[]) => { current: T[]; stale: T[] };
```

`trainLocalModel` y `trainingReadiness` reciben solo `current`. Un registro antiguo ya no hace
fallar el entrenamiento: simplemente no cuenta. `train-community.ts` usa la misma función e informa
de cuántos excluyó en `VALIDACION-CI.md`.

`predictLocalModel` no cambia: `describeAudio` sigue lanzando con un registro antiguo, y
`ModelAdvice` ya lo captura; el mensaje pasa a decir que la muestra necesita reanálisis.

### Reanálisis (`components/workspace/useWorkspace.ts`)

- **Al abrir.** `select()` ya analiza el audio guardado. Si `result.features.version !==
  record.features.version`, guarda las características nuevas con un `refreshFeatures(id, features)`
  que **no pasa por el filtro de campos del estudiante**: no es una edición, es la misma medición
  repetida, y la puede provocar cualquier rol. Pasa por `updateReview`, así que `trainingUpdatedAt`
  se mueve y el modelo caduca, que es lo correcto.
- **Por lotes.** `reanalyze()`: recorre los registros `stale` que tienen audio, uno a uno, con el
  mismo `AbortController`, etapas y cola de guardado que `files()`. Los que no tienen audio se
  cuentan y se saltan. Aviso final: «N reanalizadas · M sin audio, siguen puntuables».

### Interfaz

- **Modelo local** (`LearningView`): junto a los contadores, «N muestras en una versión anterior:
  puntúan, pero no entrenan» y el botón **Reanalizar las que tienen audio** (deshabilitado si ninguna
  lo tiene). Si `stale` está vacío, no aparece nada.
- **Biblioteca**: pastilla «reanálisis pendiente» en la fila, para que se vea sin ir a buscarlo.
- **Análisis**: si la muestra abierta es antigua y no tiene audio, una línea bajo las mediciones lo
  dice y explica que vuelva a subir el original para actualizarla (la huella lo reconoce).

### Guardián del corpus (`tests/corpus-version.test.ts`)

Lee `public/corpus/coleccion.json` y `public/corpus/modelo.json` del disco y comprueba que todos los
registros están en `FEATURES_VERSION` y el modelo en `DESCRIPTOR_VERSION`. Falla en CI ante un
cambio de versión sin regenerar el corpus (`npm run corpus:build`, sin red: las fuentes están en
disco).

## Pruebas

Unitarias, antes que el código:

- `version.ts`: parseo, aceptación por mayor/menor, rechazo de cadenas inválidas.
- Esquema: una colección con `features.version` `2.0.0` (misma forma) se importa; `1.9.0` y `3.0.0`
  se rechazan; la colección actual sigue igual.
- `splitByFeatureVersion`: separa y no muta; `trainingReadiness` sobre `current` ignora lo antiguo;
  `trainLocalModel` no falla por la presencia de un registro antiguo en la colección completa.
- `calculateReview` puntúa igual un registro antiguo (mismos campos de medida).
- Guardián del corpus contra los archivos reales.

De navegador: se siembra una colección con un registro en `2.0.0` sin audio; Modelo local muestra el
contador y el botón deshabilitado; la biblioteca muestra la pastilla; la nota de ese registro se ve.
Con audio: subir un archivo, forzar su versión a `2.0.0` en IndexedDB, abrirlo, y comprobar que
vuelve a `2.1.0` y desaparece la pastilla.

## Fuera de alcance

- Cambiar `FEATURES_VERSION` o los descriptores. Eso es el bloque D.
- Funciones de migración por versión.
- Versionar aparte los descriptores del modelo (`DESCRIPTOR_VERSION` ya deriva de la versión de
  características; separarlos era la opción 2 y se descartó).

## Riesgos

- **Un registro antiguo con audio que el navegador ya no puede decodificar** se queda antiguo para
  siempre; queda señalado como los que no tienen audio. Aceptable.
- **El reanálisis al abrir escribe sin que el profesor haya pedido nada.** Es la misma medición
  determinista; el único efecto visible es que el modelo caduca, y ya se avisa de eso.
- **La regla mayor/menor es una convención**, no la impone el compilador. La prueba guardiana y la
  cabecera de `features.ts` son lo que la mantiene viva.
