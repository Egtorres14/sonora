# Detectar la reversa: por qué falla hoy y qué haría que funcione

Estado (corpus/VALIDACION.md): con descriptores globales la reversa se queda en 55 % de exactitud equilibrada. No es un problema de cantidad de datos: **invertir material sostenido (drones, ambientes, tonos, voz continua) no deja ninguna huella en el espectro promedio ni en la envolvente**, y los segmentos invertidos cortos se diluyen en un archivo de 20–60 s. Las propuestas, de mayor a menor rendimiento esperado.

## 1. Verificar contra la fuente (recomendada; resuelve el problema de raíz)

El ejercicio parte de "un solo sonido" que el profesor conoce. Si la fuente está en la biblioteca (ya existe el control *Comparar con una fuente*), la reversa deja de ser una adivinanza y pasa a ser una **medición exacta**:

- Correlación cruzada por FFT entre el trabajo del estudiante y la **fuente invertida**. Un segmento invertido produce un pico de correlación nítido (r ≈ 1 a nivel de muestra) en la posición exacta; un segmento no invertido correlaciona con la fuente normal. Funciona con material sostenido, con reverb añadida y con segmentos cortos, porque compara forma de onda, no estadísticas.
- Robustez a cambios de nivel y filtros: normalizar por bloques y correlacionar la envolvente espectral (STFT log-mel) además de la forma de onda. Robustez a pitch shift/time stretch simultáneos: buscar la correlación sobre una rejilla de factores (0,5×–2×, ±12 semitonos) o usar DTW sobre cromas/espectros; esto también detecta el pitch shift y el time stretch **midiendo el factor**, que hoy quedan en 68–70 %.
- Coste: una FFT de 2·N por par (fuente, trabajo) y por factor; para 60 s a 48 kHz son décimas de segundo en el worker.
- Salida para el profesor: "0:12–0:19 coincide con la fuente invertida (r = 0,97); 0:31–0:40 coincide con la fuente a +5 semitonos". Evidencia navegable en la forma de onda.

Implementación: `services/audio/compare.ts` (correlación normalizada por FFT, ya existe `autocorrelation` en dsp.ts como base), integración en la vista de análisis junto al selector de fuente, y etiquetas sugeridas con la evidencia temporal. Es el cambio con mejor relación esfuerzo/beneficio del proyecto.

## 2. Declaración del estudiante con marcas de tiempo

Pedir en la entrega qué herramientas usó y dónde (`0:12–0:19 reversa`). El modelo y el profesor pasan de "detectar" a "verificar una afirmación" (mucho más fiable) y el corpus real se etiqueta solo. Combinado con la propuesta 1, la verificación es automática.

## 3. Descriptores locales en lugar de globales

Hoy cada archivo produce un vector. Calcular los descriptores por ventanas (2–3 s con solape) y agregar por extremos (mínimo de la asimetría, máximo de la fracción de repetición, etc.) hace visibles los segmentos invertidos cortos que la media oculta. Coste bajo (mismo código en bucle); mejora esperada moderada en reversa por segmentos, nula en material sostenido.

## 4. Firma físico-acústica de la reverberación invertida

En una cola de reverb natural las frecuencias altas decaen antes que las graves (absorción del aire y materiales): el centroide espectral **baja** durante la caída. Invertida, el centroide **sube** hacia el corte. Medir la pendiente centroide-vs-tiempo en cada transición de energía (subida o bajada ≥ 10 dB) y agregar (media y fracción de pendientes positivas) da una pista que funciona incluso en ambientes y voz con sala, donde la envolvente no ayuda. Es la propuesta con más recorrido dentro del enfoque "un solo archivo"; conviene medirla en el corpus antes de darla por buena.

## 5. Modelo sobre espectrogramas (a medio plazo)

Una red pequeña sobre log-mel (por ejemplo, 2–3 capas convolucionales) aprende patrones temporales que los descriptores manuales no capturan. Puede ejecutarse en el navegador (ONNX Runtime Web o TensorFlow.js) y entrenarse en CI con el corpus generado. Requiere bastantes más datos (miles de segmentos) y una evaluación externa seria; sin eso no ofrece garantías y no debe presentarse como validado.

## Qué haría yo, en orden

1. Propuesta 1 (comparación contra la fuente) con detección de reversa, pitch y stretch por factores; es medible de inmediato con el corpus, porque cada variante conserva su original.
2. Propuesta 2 en la plantilla de entrega.
3. Propuestas 3 y 4 como descriptores adicionales del modelo local, comprobadas con `npm run corpus:build -- --wav none` y `evaluate-corpus`.
4. Propuesta 5 solo cuando haya corpus real y contribuciones suficientes.
