# Auditoría técnica y de producto — Audio Project Evaluator AI

> **Actualización de implementación — Sonora, 07/09/2026.** El contenido posterior conserva el diagnóstico y las propuestas anteriores; no es una lista de prestaciones actuales. El estado vigente está en [README](../README.md) y [Muestras y validación](MUESTRAS-Y-VALIDACION.md). Se implementó el flujo local sin IA obligatoria, revisión humana con etiquetas pendientes, biblioteca IndexedDB con lotes/deduplicación/respaldo JSON, entrenamiento de bosques aleatorios con validación por origen y el diseño Sonora con fuentes y estilos locales. Se corrigieron la aritmética al editar, persistencia de nota manual, consenso N/A, recuperación de cargas, metadatos FLAC, muestras PCM no finitas y exportación del balance estéreo infinito. La reproducción AIFF usa una copia compatible sin cambiar el original. No hay corpus real etiquetado, precisión real demostrada ni llamadas externas facturables verificadas. Los precios y recomendaciones de la sección 6 son contexto histórico y deben comprobarse antes de usar una API.

Fecha: 7 de septiembre de 2026. Alcance: revisión completa del código original (generado en AI Studio), medición del margen de error real de cada métrica con señales sintéticas, rediseño de la lógica, sistema multi-proveedor (Gemini / OpenAI / Claude) y propuesta visual.

## 1. Qué es el proyecto

Una web (React 19 + Vite + Tailwind CDN) para que un profesor de producción de audio suba el `.wav` de un estudiante y reciba una nota sobre 30 puntos:

| Bloque | Puntos | Cómo se decidía en el código original |
|---|---|---|
| Formal (sinopsis presente, nombre de archivo no genérico) | 5 | Lo decidía el LLM |
| Técnica (48 kHz, clipping, clics, duración 55–65 s) | 12,5 | El navegador medía; el LLM restaba puntos |
| Creatividad (pitch shift, time stretch, reversa, filtros; sobreprocesamiento) | 12,5 | El LLM "escuchaba" y restaba |
| Extra (delay, reverb, modulación, generador de tonos) | +0,5 | El LLM |

Flujo original: `FileUpload` → `parseAudioHeader` + `analyzeAudioClientSide` (pico, "LUFS", clics) → `geminiService.analyzeAudio` (audio base64 + prompt con la rúbrica a `gemini-2.5-flash`, `responseSchema`) → `EvaluationDisplay` con campos editables.

## 2. Lo que parece funcionar pero no

Reproduje la lógica original de `services/analyzer.ts` sobre señales sintéticas (script en `tests/` y en el scratchpad de la sesión). Resultados literales:

| Prueba | Valor real | Lo que devolvía el código original | Consecuencia en la nota |
|---|---|---|---|
| Tono limpio 8 kHz a −3 dBFS, 60 s, estéreo (sin ningún clic) | 0 clics | **1200 clics** | −4 puntos a un archivo perfecto |
| Ruido blanco a −12 dBFS (lluvia, viento, mar) | 0 clics | **1199 clics** | −4 puntos a cualquier paisaje sonoro con textura |
| Clic real de edición (+0,35 en 1 muestra) en un tono suave | 1 clic | **0 clics** | El error que sí importa pasa desapercibido |
| Clic en canal derecho a 2 s y en izquierdo a 50 s | 2 clics | **1 clic** | Bug: el segundo canal solo cuenta si su clic ocurre después del último del primero |
| Referencia EBU Tech 3341: seno 1 kHz −23 dBFS estéreo | −23,0 LUFS | **−12,0 "LUFS"** | 11 dB de error; el número no significa nada |
| Tono 8 kHz a −3 dBFS | ≈ −5 LUFS | **+8 "LUFS"** | Un valor imposible (el máximo físico es ≈ 0) |
| 500 muestras seguidas saturadas a +fondo de escala (16 bit) | clipping | **sin clipping** | 32767/32768 = 0,99997 < 1,0: el umbral `>= 1.0` solo salta con el fondo de escala negativo |
| Archivo a 96 kHz con un clic en el segundo 30 | 30,0 s | **15,0 s** | `decodeAudioData` remuestrea a la tasa del dispositivo, pero el código divide por la tasa de la cabecera |
| Seno a fs/4 con fase π/4 (muestras ±0,707) | 0 dBTP | **−3,01 "true peak"** | Se llamaba true peak al pico de muestra; puede infravalorar hasta 3 dB |

Causas:

- **"LUFS"** era `20·log10(RMS) + 14`. No hay ponderación K, ni bloques de 400 ms, ni puertas. Además dividía la suma de cuadrados entre `length × canales`, que no es la suma de potencias por canal que exige BS.1770.
- **Clics** era `|x[n] − x[n−1]| > 0.4`. Cualquier contenido fuerte por encima de ~3 kHz supera esa diferencia entre muestras consecutivas de forma natural. El umbral fijo no distingue un clic de un platillo.
- **Clipping** era `pico >= 1.0`. En PCM entero el fondo de escala positivo nunca llega a 1,0. Además un único pico no es clipping: hace falta una racha.
- **Marcadores en la forma de onda**: `ws.addRegion` no existe en wavesurfer v7 (Regions es un plugin). Lanzaba una excepción dentro del evento `ready` y los marcadores nunca se pintaban. `tsc` lo señalaba como error de tipos.

### 2.1 El LLM hacía trabajo que no le corresponde

- El prompt le pedía **restar puntos** siguiendo reglas ("si sampleRate ≠ 48000, deduce 2,5"). Los modelos fallan aritmética condicional con frecuencia y, sin `temperature`, Gemini muestrea a 1,0: **la misma entrada da notas distintas en cada ejecución**.
- Le pedía decidir cosas triviales y deterministas (sinopsis vacía, nombre genérico, `sample_rate`, `bit_depth`, `duracion`), que ya se conocían en código. Cada campo es una oportunidad de alucinar.
- Le pedía la **suma final**, que la UI luego recalculaba solo al editar. Nota mostrada y desglose podían no cuadrar.

### 2.2 La parte creativa era una moneda al aire (10 de 30 puntos)

- Gemini mezcla el audio a **mono** y lo remuestrea a **16 kHz** (32 tokens/s; documentado en ai.google.dev/gemini-api/docs/audio). No oye nada por encima de 8 kHz ni la imagen estéreo. Aliasing, "sonido metálico", brillo, anchura estéreo, y si el archivo "de verdad" era 48 kHz son **indetectables de oído** para el modelo.
- Se le pedía un booleano `detectado` por herramienta **sin evidencia ni confianza**. Cada herramienta "no detectada" restaba 2,5 puntos. Ningún LLM de audio actual tiene un detector fiable de pitch shift / time stretch / reversa: es una estimación con sesgo a complacer.
- Sin repetición ni consenso: una sola llamada decide.

### 2.3 Otros fallos

- **Clave de API en el bundle**: `vite.config.ts` inyectaba `GEMINI_API_KEY` con `define`; cualquiera que abra la web puede extraerla.
- **Límite de tamaño**: un minuto a 48 kHz / 24 bit / estéreo pesa 17 MB (23 MB en base64) y supera los 20 MB inline de Gemini: error 400 para archivos perfectamente válidos.
- **`file.type` vacío**: Windows y varios navegadores dan MIME vacío a `.aiff`/`.aif`; `FileUpload` los rechazaba con `alert()`.
- **`index.html`** cargaba React tres veces (importmap a aistudiocdn + `unpkg` wavesurfer + bundle de Vite), enlazaba un `index.css` inexistente, usaba `animate-fade-in` sin definirla y declaraba `lang="en"` en una app en español.
- **Edición de la nota final ignorada**: `recalculateTotal` sobrescribía cualquier edición manual de `calificacion_final`.
- Análisis en el hilo principal (bloquea la UI con archivos largos), sin tests, sin lint, mensajes mezclados en inglés/español, errores detectados por `string.includes('400')`.

## 3. Qué se ha hecho en esta sesión

### 3.1 DSP defendible (`services/audio/`)

| Métrica | Implementación | Validación (vitest, 34 tests) |
|---|---|---|
| Sonoridad | ITU-R BS.1770-4 / EBU R128: ponderación K recalculada para cualquier fs, bloques 400 ms / hop 100 ms, puerta absoluta −70 LUFS y relativa −10 LU; short-term 3 s; LRA (EBU 3342, percentiles 10–95, puerta −20 LU) | EBU Tech 3341 casos 1 y 2: −23,0 y −33,0 LUFS ±0,1 a 44,1 / 48 / 96 kHz |
| True peak | FIR polifásico windowed-sinc ×4 (×2 a ≥ 96 kHz), Annex 2 | Seno a fs/4 con fase π/4: −3,01 dBFS de muestra → > −0,3 dBTP |
| Clipping | Rachas ≥ 3 muestras a fondo de escala exacto según bit depth (float: > 0,999 y `floatOvers` > 1,0) | 500 muestras seguidas → detectado; 1 muestra aislada → no |
| Clics | Residuo de predicción lineal (LPC orden 16, Levinson-Durbin, frames 2048) con umbral robusto MAD por frame, prueba de cambio de nivel (descarta ataques musicales) y exclusión de zonas saturadas | Clic +0,3 y +0,05 detectados con timestamp exacto; tono 8 kHz: 0; ruido: 0; golpe percusivo: 0; ambos canales; 96 kHz correcto |
| Cortes sin crossfade | Detector de escalón: salto muestra-a-muestra anómalo respecto al MAD del material anterior **y** posterior | Corte seco entre dos tonos → discontinuidad; rampa de 5 ms → nada |
| Decodificación | Decodificador PCM propio para WAV (PCM, float, EXTENSIBLE, RF64) y AIFF/AIFC (`sowt`, `fl32`) en la **tasa nativa**, con bit depth real; Web Audio solo como fallback | Roundtrip 16 bit |
| Extras | DC offset, silencio inicial/final/huecos, correlación y balance estéreo, dual mono, centroide/roll-off/planitud, ancho de banda real (detecta fuentes a 16 kHz remuestreadas), heurístico de "envolvente en reversa" | Tests unitarios |

Todo corre en un **Web Worker** (`analysis.worker.ts`); un archivo estéreo de 60 s se analiza en ≈ 2,4 s.

### 3.2 Puntuación determinista (`services/scoring/rubric.ts`)

La rúbrica es un objeto `RubricConfig` (puntos, umbrales, patrones de nombre genérico, herramientas obligatorias, confianza mínima). `scoreFormal`, `scoreTechnical` y `scoreCreative` calculan cada línea con su detalle y su fuente (`medido` / `formal` / `modelo`). El LLM **nunca** suma ni resta.

### 3.3 Sistema multi-proveedor (`services/llm/`)

- Interfaz `LLMProvider` común; un único esquema zod (`CreativeAssessmentSchema`) que se convierte a JSON Schema para Gemini (`responseJsonSchema`), a `zodResponseFormat` para OpenAI (con fallback a `json_object` si el modelo de audio rechaza `json_schema`) y a `zodOutputFormat` con `messages.parse` para Claude.
- El modelo solo devuelve **detecciones + evidencia con timestamps + confianza 0–1 + limitaciones**. La confianza se usa: por debajo de 0,5 una herramienta "detectada" no cuenta.
- **Consenso**: 1, 3 o 5 ejecuciones en paralelo; booleanos por mayoría, confianza ponderada por acuerdo, textos del run más representativo; la UI muestra el % de acuerdo y las decisiones sin unanimidad.
- Cada proveedor recibe lo que puede procesar: Gemini audio (mono 16 kHz PCM16 normalizado, ~1,9 MB/min) + espectrograma; OpenAI solo audio; Claude espectrograma log + forma de onda + métricas.
- Catálogo con precios verificados, estimación de coste antes de evaluar y coste real por tokens después.
- Errores tipados por proveedor (auth / cuota / 400 / 5xx / red / refusal / parse) con mensajes útiles.

### 3.4 UI

Panel "Motor de IA" (proveedor, modelo con etiqueta y coste/eval, clave con opción de recordarla, ejecuciones), resumen de métricas antes de evaluar, resultados con desglose por criterio, confianza por herramienta (corregible con un checkbox), descripción de lo que el modelo dice haber oído, fortalezas/mejoras/limitaciones, panel de fiabilidad, reproductor con marcadores reales (Regions plugin) de clics, cortes, clipping, silencios y pistas de reversa, exportación JSON, cancelación.

## 4. Cómo mejorarlo de verdad (siguiente nivel)

1. **Validar el DSP con material real**: el EBU Loudness Test Set v5 (70 WAV con valores esperados, tech.ebu.ch/publications/ebu_loudness_test_set) como fixtures de vitest. Comparar true peak contra `ffmpeg -af ebur128=peak=true`.
2. **Calibrar la parte subjetiva contra el profesor**: tomar 20–30 proyectos ya corregidos a mano, ejecutar cada modelo 5 veces y medir acuerdo (kappa de Cohen por herramienta, error medio en la nota). Sin este dato no se puede afirmar que ningún modelo "funciona". Con él, se elige modelo y se ajusta `toolMinConfidence`.
3. **Declaración del estudiante**: pedir en la entrega qué herramientas usó y dónde (timestamps). El modelo pasa de "adivinar" a "verificar una afirmación", que es una tarea mucho más fiable, y el profesor solo revisa discrepancias.
4. **Backend mínimo para las claves** (Cloudflare Worker / Vercel Function / Express de 60 líneas) que reciba `{features, audio16k, spectrogram}` y llame al proveedor. Imprescindible antes de compartir la app.
5. **Corrección por lotes**: arrastrar una carpeta, cola de análisis en el worker, tabla con notas, exportar CSV/Excel y PDF por alumno (`@react-pdf/renderer`).
6. **Rúbrica editable en la UI** (ya es un objeto): puntos, tolerancias, herramientas obligatorias por ejercicio, guardada por asignatura.
7. **Historial y trazabilidad**: guardar evaluación + métricas + versión del prompt/modelo (IndexedDB o backend) para poder auditar una nota meses después.
8. **Evidencia navegable**: cada afirmación del modelo con timestamp se convierte en una región clicable de la forma de onda (ya existe la infraestructura de marcadores).
9. **Vista de espectrograma en la UI** (plugin Spectrogram de wavesurfer) para que el profesor vea lo mismo que ve Claude.
10. **Honestidad permanente en la interfaz**: distinguir siempre "medido" de "juicio del modelo", mostrar el acuerdo y las limitaciones. Ya está; hay que mantenerlo cuando se rediseñe.

## 5. Diseño visual: diagnóstico y propuesta

### Diagnóstico

La UI actual es el "kit de tarjetas SaaS" por defecto: fondo #121212, tarjetas idénticas con el mismo radio y sombra, acento púrpura (#6A3DE8) + verde ácido (#3DE8A6), todo centrado, spinner genérico, título en inglés. La información más valiosa (dónde está cada clic, cuánto se desvía cada métrica) estaba enterrada en párrafos en cursiva. Nada comunica que esto es una herramienta de **medición**.

### Concepto: consola de medición

El referente es una consola de estudio y los medidores de sonoridad (Nugen, iZotope Insight, Youlean): instrumentos con escalas, no tarjetas con prosa.

- **Paleta**: gris azulado profundo de consola `#1A2129` (fondo), paneles `#232C36`, tinta `#E8EDF2`, secundaria `#98A6B3`, acento único "teal de bakelita" `#2FB7C1` para lo interactivo; escala semántica solo en los medidores: verde `#3FB27F` / ámbar `#E0A63B` / rojo `#E05A4F`. Versión clara con los mismos tokens (`#EEF1F4` / `#FFFFFF` / `#1B2530`).
- **Tipografía**: `Barlow Condensed` 600–700 para títulos y etiquetas de instrumento (rotulación de consola), `IBM Plex Sans` para texto, `IBM Plex Mono` con `tabular-nums` para todos los valores. Nada de mayúsculas espaciadas en cada etiqueta; los valores son los protagonistas.
- **Layout**: tres estados claros, alineados a la izquierda, ancho máximo 1200 px.
  1. **Entrada**: zona de drop a la izquierda, a la derecha el panel de motor (proveedor/modelo/coste) siempre visible.
  2. **Mesa de análisis** (tras subir): una fila de **instrumentos**: LUFS integrado con escala −30…0 y objetivo, true peak con LED de sobre-nivel, LRA, clipping (contador), clics (contador). Debajo la forma de onda con marcadores y un espectrograma. El profesor ve el diagnóstico técnico **antes** de gastar dinero en el modelo.
  3. **Informe**: columna izquierda con la nota final y el radar de la rúbrica (formal / técnica / creatividad / extra); columna derecha con el desglose línea a línea (icono "medido" vs "modelo", puntos, evidencia con timestamp clicable); abajo las 5 herramientas como tiras de canal con su fader de confianza; cierre con el feedback al estudiante listo para copiar o exportar a PDF.
- **Motion**: una única animación al terminar el análisis (los medidores suben a su valor). Nada de fade-in en cada tarjeta.
- **Stack recomendado**: Tailwind v4 vía `@tailwindcss/vite` (quitar el CDN), shadcn/ui (Base UI), `lucide-react`, `motion` solo para los medidores, Recharts (radar) o SVG a mano, `sonner` para toasts, `@react-pdf/renderer` para el informe, plugins Timeline/Hover/Spectrogram/Minimap de wavesurfer.

## 6. Modelos, precios y recomendación (verificados el 07/09/2026)

Coste de una evaluación de 60 s (≈ 2 500 tokens de prompt + 1 500 de salida; audio: Gemini 1 920 tokens, OpenAI ≈ 600; Claude recibe un PNG de 1400×560):

| Modelo | Escucha audio | Ve imagen | $/M entrada (texto / audio) | $/M salida | ≈ $/eval | 1 000 evals |
|---|---|---|---|---|---|---|
| `gemini-3.8-flash` (GA 02/09/2026) | sí | sí | 0,75 / 0,75 (hasta 31/12/2026) | 3,75 | 0,008 | $8 |
| `gemini-3.5-flash-lite` | sí | sí | 0,30 / 0,30 | 2,50 | 0,005 | $5 |
| `gemini-3.1-pro-preview` | sí | sí | 2,00 / 2,00 | 12,00 | 0,025 | $25 |
| `gemini-2.5-flash` (original) | sí | sí | 0,30 / 1,00 | 2,50 | 0,006 | $6 |
| `gpt-audio-mini` | sí | no | 0,60 / 10 | 2,40 | 0,011 | $11 |
| `gpt-audio-1.5` | sí | no | 2,50 / 32 | 10 | 0,038 | $38 |
| `gpt-4o-audio-preview` | sí | no | 2,50 / 40 | 10 | 0,043 | $43 |
| `claude-haiku-4-5` | no | sí | 1,00 | 5 | 0,010 | $10 |
| `claude-sonnet-5` | no | sí | 2,00 | 10 | 0,021 | $21 |
| `claude-opus-5` | no | sí | 5,00 | 25 | 0,052 | $52 |

Recomendación:

- **Por defecto: `gemini-3.8-flash`, 3 ejecuciones** (≈ $0,025 por proyecto). Es el único proveedor que escucha audio y ve el espectrograma a la vez, con salida estructurada nativa.
- **Segunda opinión: `claude-sonnet-5`** sobre espectrograma + métricas. Su fuerte es razonar sobre los datos medidos y escribir feedback claro; para "escuchar" no sirve porque Claude no acepta audio (confirmado en la documentación de modelos).
- **OpenAI solo si ya se paga esa plataforma**: `gpt-audio-mini` es el único a precio razonable; los modelos GPT-5.x / GPT-6 no aceptan audio. Chat Completions únicamente; `json_schema` estricto no está confirmado en los modelos de audio (la app tiene fallback).
- Ningún modelo puede juzgar lo que ocurre por encima de 8 kHz ni la imagen estéreo: por eso esas cosas se miden en el navegador y se le pasan como datos.

## 7. Repos y recursos útiles

Medición
- ITU-R BS.1770 (itu.int/rec/R-REC-BS.1770), EBU R128 (tech.ebu.ch/docs/r/r128.pdf), EBU Tech 3341/3342, EBU Loudness Test Set v5 (tech.ebu.ch/publications/ebu_loudness_test_set).
- libebur128 (github.com/jiixyj/libebur128, MIT) — referencia canónica; `ebur128` en Rust (github.com/sdroege/ebur128) para WASM.
- `@audio/loudness` (github.com/audiojs/loudness, MIT) — LUFS/LRA/true peak en JS puro, útil como contraste.
- Essentia (essentia.upf.edu) — `ClickDetector`, `DiscontinuityDetector`, `GapsDetector`, `SaturationDetector`, `TruePeakDetector`; essentia.js (AGPL) si la licencia encaja.
- Godsill & Rayner, *Digital Audio Restoration* (Springer) — detección de clics por residuo AR (base de lo implementado).
- Meyda (github.com/meyda/meyda, MIT) — centroide, planitud, MFCC.
- wavefile (github.com/rochars/wavefile, MIT) y music-metadata (github.com/Borewit/music-metadata) — parsing de contenedores.
- Comlink (github.com/GoogleChromeLabs/comlink) — RPC para workers.

Detección de efectos (estado del arte, sin solución cerrada)
- Guo & McFee, "Automatic Recognition of Cascaded Guitar Effects", DAFx23; Fx-Encoder++ (github.com/SonyResearch/Fx-Encoder_PlusPlus); IDMT-SMT-Audio-Effects (dataset); Průša & Holighaus, "Phase Vocoder Done Right" (artefactos de time stretch).

UI
- wavesurfer.js v7 y plugins (github.com/katspaugh/wavesurfer.js), waveform-playlist (github.com/naomiaro/waveform-playlist), peaks.js (github.com/bbc/peaks.js), Sonic Visualiser (referencia de capas), shadcn/ui, Recharts, motion, sonner, @react-pdf/renderer, lucide.
- Rúbricas: Submitty (github.com/Submitty/Submitty) como modelo de UI de corrección con componentes, puntos y comentarios.

Abstracción de proveedores
- Vercel AI SDK 7 (`ai`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/anthropic`) con `Output.object` — alternativa a la capa propia si se quiere mover todo a un backend Node.

## 8. Cómo verificar

```bash
npm install
npm test          # 34 tests: BS.1770, true peak, clipping, clics, WAV, rúbrica
npx tsc --noEmit  # sin errores
npm run dev       # http://localhost:3000
```

Archivo de prueba sintético con 2 clics, 200 ms de clipping y un crescendo en reversa: generado en la sesión (`bosque_campana_prueba.wav`); la app detecta los tres.
