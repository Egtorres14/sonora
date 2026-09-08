# Validación del modelo local sobre el corpus generado

Corpus v1–v2: 600 registros (12 variantes por fuente). Corpus v3: 894 registros (18 variantes por fuente, 6 duplicadas descartadas), publicado en `public/corpus/`. 50 grupos de origen (grabaciones de dominio público / CC0 procesadas con `scripts/corpus/build-corpus.ts`, semilla 1, clips de ≤ 20 s). Entrenamiento y validación con el código de la app (`services/learning/model.ts`, 3 particiones separadas por grupo de origen). Comandos: `npm run corpus:model` (entrena y escribe `public/corpus/modelo.json`), `npx tsx scripts/corpus/evaluate-corpus.ts public/corpus/coleccion.json`.

## Descriptores v1 (`spectrum-summary-v1`: espectro promedio + dinámica global)

| herramienta | exactitud equilibrada | precisión | sensibilidad | VP/VN/FP/FN |
|---|---|---|---|---|
| pitch_shift | 69 % | 62 % | 45 % | 55/445/34/66 |
| time_stretch | 71 % | 68 % | 49 % | 62/444/29/65 |
| reversa | 52 % | 40 % | 5 % | 6/472/9/113 |
| filtros | 66 % | 48 % | 44 % | 50/432/55/63 |
| loops | 51 % | 44 % | 3 % | 4/472/5/119 |

Lectura: con descriptores globales, reversa y loops no se distinguen del azar (invertir o repetir un segmento no cambia el espectro medio). Pitch shift y time stretch se detectan a medias por los artefactos del phase vocoder y del remuestreo. Estas cifras miden la separabilidad sobre este corpus, no el rendimiento sobre trabajos de estudiantes.

## Descriptores v2 (`spectrum-temporal-v2`: + asimetría subida/caída de los picos, periodicidad, repeticiones idénticas a nivel de muestra, cresta de flujo)

| herramienta | exactitud equilibrada | precisión | sensibilidad | VP/VN/FP/FN |
|---|---|---|---|---|
| pitch_shift | 68 % | 57 % | 45 % | 54/438/41/67 |
| time_stretch | 70 % | 63 % | 47 % | 60/437/36/67 |
| reversa | 55 % | 41 % | 17 % | 20/452/29/99 |
| filtros | 68 % | 46 % | 50 % | 56/421/66/57 |
| loops | 71 % | 86 % | 44 % | 54/468/9/69 |

Lectura:

- **loops** pasa de 51 % a 71 % gracias al detector de repeticiones idénticas (autocorrelación por FFT + coincidencia de bloques de 20 ms). Precisión 86 %: cuando sugiere un loop casi siempre lo hay; se le escapan loops muy cortos o con crossfade largo. Un tono perfectamente periódico también puntúa alto (limitación conocida).
- **reversa** solo sube de 52 % a 55 %. La asimetría subida/caída separa las colas de la distribución (percusión, campanas, chimes invertidos) pero la mediana es 0 en ambas clases: invertir material sostenido (drones, ambientes, tonos, voz continua) no deja huella en la envolvente, y los segmentos invertidos cortos quedan diluidos en 20 s. Es un límite físico de los descriptores globales, no del corpus: la reversa debe confirmarla el profesor o declararla el estudiante.
- **pitch_shift / time_stretch / filtros** se quedan en 68–70 %: los artefactos del phase vocoder y del remuestreo son visibles en el espectro promedio, pero un cambio de altura o de duración sin la fuente original es intrínsecamente ambiguo. Comparar contra la fuente en la biblioteca (función "Comparar con una fuente") es la vía fiable.

Iteraciones registradas: v1 (solo espectro) → v2 con asimetría por energía (reversa 53 %, muchos picos no detectados) → v2 con tiempos de subida/caída adaptativos (tabla anterior). Cada rebuild: `npm run corpus:build -- --wav none` y `npx tsx scripts/corpus/evaluate-corpus.ts`.

## Corpus v3 (894 registros) con clases equilibradas

Al pasar a 18 variantes por fuente la proporción es de 1 positivo por cada 3,7 negativos. Sin corregirla, el bosque aprende a decir «ausente» (reversa: 15 % de sensibilidad, pitch shift 33 %). `services/learning/model.ts` repite ahora de forma determinista las muestras de la clase minoritaria hasta igualar a la mayoritaria antes de entrenar cada árbol.

| herramienta | sin equilibrar | **equilibrado** (modelo publicado) | precisión | sensibilidad | VP/VN/FP/FN |
|---|---|---|---|---|---|
| pitch_shift | 62 % | **77 %** | 51 % | 73 % | 138/572/132/52 |
| time_stretch | 64 % | **76 %** | 53 % | 68 % | 133/583/116/62 |
| reversa | 56 % | **62 %** | 45 % | 36 % | 68/620/84/122 |
| filtros | 69 % | **74 %** | 49 % | 68 % | 138/549/143/64 |
| loops | 71 % | **74 %** | 58 % | 58 % | 106/634/78/76 |

Lectura:

- Equilibrar clases sube la exactitud equilibrada entre 3 y 15 puntos y, sobre todo, la sensibilidad: el modelo ya no se limita a decir «ausente». A cambio baja la precisión (más falsos positivos); por eso la app sigue absteniéndose cuando los votos quedan entre 35 % y 65 % y presenta todo como sugerencia.
- **Hiperparámetros** (`npm run corpus:tune`, corpus v2): 40 árboles × profundidad 8 → media 66,5 % en 184 s; 100 × 10 → 66,9 % en 596 s. La ganancia no compensa triplicar el tiempo de entrenamiento en el navegador, así que `DEFAULT_FOREST` sigue en 40 × 8.
- **Reversa** mejora de 55 % a 62 %, pero sigue siendo la herramienta más débil por el límite físico descrito arriba: sin picos claros, invertir no deja huella global.
- Entrenar con los 894 registros tarda unos 15 minutos en Node (unos 6 sin equilibrar); en el navegador, tiempos similares en un *worker*. Por eso la app ofrece el modelo ya entrenado desde **Muestras**.
