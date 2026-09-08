# OpenRouter, modos de análisis y feedback redactado por IA

Fecha: 2026-09-07. Estado: aprobado por el profesor en conversación; implementado en la misma sesión.

## Objetivo

1. Añadir **OpenRouter** como cuarto proveedor externo, con modelos que escuchan audio (incluidos dos gratuitos) y el mismo contrato de salida que Gemini, OpenAI y Anthropic.
2. Que el modelo externo sirva de **refuerzo del clasificador local** (bosques aleatorios entrenados con la biblioteca): recibe las predicciones locales y las etiquetas del profesor, y las confirma o refuta con evidencia.
3. Que la IA **redacte el feedback** para el estudiante a partir de la revisión cerrada del profesor, en lugar del borrador determinista, cuando el profesor lo active.
4. Que el profesor elija estos **modos una sola vez** en «Motores de IA» y se apliquen a todos sus estudiantes.
5. Que todo quede **persistido**: ajustes y llaves en el navegador, decisiones en este documento y en la memoria del asistente, código en git.

## Decisiones

### Llaves

- Las llaves siguen guardándose en el navegador (`sonora.key.<proveedor>`), nunca en el código: el repo se publica en GitHub Pages y cualquier llave en el bundle sería pública.
- Para desarrollo local, `.env.local` (ignorado por git vía `*.local`) puede definir `SONORA_DEV_KEY_OPENROUTER`, `SONORA_DEV_KEY_GEMINI`, etc. Solo se usan en `npm run dev` y cuando no hay llave guardada en el navegador.
- La llave de OpenRouter facilitada el 2026-09-07 está en nivel gratuito sin créditos. Comprobado en vivo: OpenRouter exige al menos 0,50 $ de saldo para **cualquier petición con audio**, incluso a modelos gratuitos; `thinkingmachines/inkling:free` solo se sirve a agentes de código (403). Con saldo 0 funcionan las peticiones de texto e imagen a `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`. «Probar» consulta `GET /api/v1/key` y `GET /api/v1/credits` y lo avisa.
- Las llaves de desarrollo NO usan el prefijo `VITE_`: Vite incrusta esas variables en el bundle de producción (se comprobó que la llave aparecía en `dist/`). En su lugar `vite.config.ts` lee `SONORA_DEV_KEY_*` con `loadEnv` y lo inyecta como `__SONORA_DEV_KEYS__` solo cuando `command === 'serve'`; en `vite build` es `{}` (verificado con grep sobre `dist/`).

### Proveedor OpenRouter (`services/llm/openrouter.ts`)

- SDK de OpenAI con `baseURL: https://openrouter.ai/api/v1` y cabeceras `HTTP-Referer` y `X-Title`.
- Audio como `input_audio` (wav base64), espectrograma como `image_url` (data URI) cuando el modelo acepta imagen.
- Salida: `response_format: json_schema` estricto cuando el modelo lo soporta (`structuredOutput` en el catálogo); si no, se pide JSON en el prompt y se extrae el primer objeto `{…}` de la respuesta (`services/llm/json.ts`; los modelos gratuitos no aceptan `response_format`).
- Si una petición con audio falla con 402 por saldo, el proveedor reintenta sin audio (espectrograma + métricas) y lo registra en `warnings`, que llega a `meta.warnings` y a la modalidad mostrada.
- Catálogo (precios de la API de OpenRouter, 2026-09-07):
  - `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (gratis, audio + imagen) → recomendado para llaves sin saldo.
  - `google/gemini-3.8-flash`, `google/gemini-3.5-flash-lite`, `openai/gpt-audio-mini`, `google/gemini-3.1-pro-preview` (de pago).

### Modos (en `EngineSettings`, persistidos en `sonora.engines.v1`)

- `analysisMode`: `independiente` (el modelo escucha sin pistas, como hasta ahora) o `refuerzo` (recibe las predicciones del clasificador local y las etiquetas/evidencias del profesor, y debe confirmarlas o refutarlas con evidencia propia, declarando cuándo discrepa). Las pistas solo se envían en las consultas del profesor: la lectura orientativa del estudiante nunca recibe decisiones sin publicar.
- `feedbackWriter`: `local` (borrador determinista de `services/feedback.ts`) o `ia` (el modelo externo redacta el texto a partir de la revisión cerrada: etiquetas, evidencias, desglose de nota, mediciones y borrador local como base). El botón «Redactar borrador» del panel de revisión usa el modo elegido. El profesor siempre edita antes de publicar.

### Prompt

- `EvaluationInput.hints` lleva las pistas del modo refuerzo. El prompt añade la sección «REFUERZO: LO QUE YA SE SABE» con reglas: no copiar, contrastar, discrepar con evidencia, y calibrar la confianza teniendo en cuenta la exactitud equilibrada de cada clasificador.
- El redactor de feedback (`services/llm/writer.ts`) usa un prompt propio: recibe la revisión cerrada y devuelve `{ texto, fortalezas, mejoras }`. No inventa detecciones: solo redacta lo que el profesor ya decidió y lo que está medido.

### Persistencia

- Ajustes y llaves: localStorage del profesor.
- Este documento y `README.md` recogen las decisiones; la memoria del asistente (`project-audio-evaluator-v2`) apunta aquí.

## Verificación (2026-09-07)

- 107 tests unitarios (incluido el reintento sin audio con `fetch` simulado) y build de producción sin llaves.
- En vivo con la llave gratuita y Nemotron: evaluación en modo refuerzo con espectrograma + métricas (unos 200 s y 10 k tokens de razonamiento; reversa detectada en 0:06.98 con confianza 1,0) y redacción de feedback a partir de una revisión cerrada (unos 40 s).
- Gemini 3.8 Flash directo (llave de AI Studio con saldo) sigue siendo la vía rápida con audio.

## Fuera de alcance

- Backend o proxy para compartir llaves entre navegadores.
- Modelos de OpenRouter que solo aceptan texto.
