# Diseño: evaluación determinista + juicio multi-proveedor

Fecha: 2026-09-07. Estado: implementado (v2.0.0 de `services/`). Este documento fija las decisiones de arquitectura para que el siguiente trabajo (rediseño visual, backend, lotes) no las deshaga.

## Objetivo

Que la nota de un proyecto de audio sea **reproducible y explicable**: todo lo medible se mide en código con algoritmos estándar y se puntúa de forma determinista; solo lo subjetivo se delega a un LLM, que devuelve detecciones con evidencia y confianza, nunca puntos. El profesor debe poder cambiar de proveedor (Gemini, OpenAI, Claude) sin que cambie la rúbrica ni la interfaz.

## Principios

1. **Medido ≠ juzgado.** Cada línea del desglose lleva su fuente (`medido`, `formal`, `modelo`). La UI nunca mezcla ambas cosas en un mismo párrafo.
2. **El LLM no hace aritmética.** Devuelve `detectado`, `confianza` (0–1), `evidencia` (con m:ss), `calidad`, `limitaciones`. El código aplica la rúbrica.
3. **Confianza con consecuencias.** Una detección por debajo de `toolMinConfidence` no cuenta. Varias ejecuciones deciden por mayoría; el acuerdo se muestra.
4. **Cada proveedor recibe lo que puede procesar.** Capacidades declaradas en el catálogo (`inputs.audio`, `inputs.image`); el prompt se adapta y declara al modelo lo que no puede oír.
5. **Sin secretos en el bundle por defecto.** Claves introducidas por el usuario (localStorage opcional) y aviso explícito; el backend es el siguiente paso.

## Arquitectura

```
File ─▶ services/audio/index.ts ─▶ Worker(analysis.worker.ts)
              │                        ├─ wav.ts       decodificador PCM nativo (WAV/AIFF), tasa y bits reales
              │                        ├─ dsp.ts       BS.1770 LUFS/LRA, true peak ×4, clipping, clics LPC, cortes, DC, silencio, estéreo, espectro, reversa
              │                        └─ features.ts  AudioFeatures (JSON serializable)
              ▼
services/evaluation.ts
   ├─ scoring/rubric.ts        scoreFormal · scoreTechnical · scoreCreative · computeFinal   (determinista, RubricConfig)
   ├─ audio/prepare.ts         mono 16 kHz PCM16 normalizado (para modelos que escuchan)
   ├─ audio/spectrogram.ts     PNG log-frecuencia + forma de onda (para modelos que ven)
   └─ llm/index.ts             runAssessment(input, {provider, model, runs})
         ├─ prompt.ts          system + user compartidos, adaptados a capacidades
         ├─ schema.ts          zod → JSON Schema (Gemini) / zodResponseFormat (OpenAI) / zodOutputFormat (Anthropic)
         ├─ gemini.ts · openai.ts · anthropic.ts
         ├─ consensus.ts       mayoría / media / moda + acuerdo + disputas
         └─ catalog.ts         modelos, capacidades, precios, estimateCost
              ▼
types.ts AudioEvaluation (+ meta: proveedor, modelo, modalidad, runs, acuerdo, coste, tokens, avisos)
```

## Contratos

- `AudioFeatures` (`services/audio/features.ts`): versión `2.0.0`. Cambios incompatibles → subir versión mayor y actualizar `prompt.ts` y `rubric.ts`.
- `RubricConfig` (`services/scoring/rubric.ts`): la única fuente de puntos y umbrales. `DEFAULT_RUBRIC` reproduce la rúbrica original (30 + 0,5).
- `CreativeAssessmentSchema` (`services/llm/schema.ts`): contrato con los tres proveedores. Todo campo nuevo debe ser obligatorio (OpenAI strict) y tener `description`.
- `LLMProvider.evaluate(input, opts) → ProviderResult`: lanza `ProviderError` con `kind` (`auth | quota | bad-request | server | network | refusal | parse | unknown`).

## Decisiones y alternativas descartadas

- **DSP propio vs librerías**: se implementó en TS puro (≈ 700 líneas) con tests contra EBU 3341 en lugar de `@audio/loudness` (2 estrellas, sin tests publicados) o essentia.js (AGPL, 2 MB de WASM). Se puede cruzar con libebur128/ffmpeg cuando haya fixtures reales.
- **Vercel AI SDK vs capa propia**: la capa propia es pequeña, no añade dependencias de servidor y controla el fallback de `json_schema` en OpenAI. Si se mueve todo a un backend Node, AI SDK 7 con `Output.object` es una alternativa razonable.
- **Audio original vs 16 kHz mono para el modelo**: Gemini remuestrea a 16 kHz mono de todas formas; enviar el original solo añadía 10× de peso y superaba el límite inline. Se normaliza a −1 dBFS porque la sonoridad absoluta ya está medida.
- **Temperatura**: 0,2 en Gemini/OpenAI; Claude Opus 5 / Sonnet 5 no aceptan `temperature` (pensamiento adaptativo activo), así que no se envía.
- **Claude sin audio**: se le da espectrograma log 1400×560 + forma de onda + métricas; es el mejor "juez de datos" aunque no escuche. No se intenta emular audio con transcripciones.

## Pruebas

- `tests/dsp.test.ts` (vitest): 34 casos con señales sintéticas deterministas. Referencias numéricas: EBU Tech 3341 casos 1–2; true peak inter-muestra; clipping por rachas; clics LPC frente a transitorios; rúbrica.
- Pendiente: fixtures del EBU Loudness Test Set; tests de `consensus.ts` con runs sintéticos; test de integración de `evaluateProject` con un proveedor simulado.

## Siguiente trabajo (en orden)

1. Backend proxy para claves (Cloudflare Worker o función serverless) y modo "sin clave en el navegador".
2. Rediseño visual "consola de medición" (ver `docs/AUDITORIA.md` §5) con Tailwind v4 vía Vite.
3. Lotes: cola de archivos, tabla, CSV y PDF.
4. Calibración con proyectos corregidos por el profesor y ajuste de umbrales de confianza.
