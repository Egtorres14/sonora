# Sonora · Laboratorio de audio

Analiza, escucha y revisa proyectos de audio en tu navegador. La evaluación funciona sin claves ni servicios de IA: las mediciones se calculan localmente y el profesor confirma los procesos creativos con evidencia. Un clasificador entrenable y los proveedores externos son ayudas opcionales.

## Ejecutar

Requisitos: Node.js 22 o posterior, navegador moderno y almacenamiento local habilitado.

```sh
npm install
npm run dev
```

Abre **http://127.0.0.1:3000**. Usa siempre la misma dirección y puerto: IndexedDB pertenece al origen del navegador; `localhost` y `127.0.0.1` tienen bibliotecas diferentes.

```sh
npm test                 # DSP, formatos, rúbrica, consenso, biblioteca y modelo
npm run typecheck
npm run build
npx playwright install chromium --only-shell  # primera ejecución de E2E
npm run test:e2e
```

En PowerShell puedes usar `npm.cmd` y `npx.cmd` si la política de scripts bloquea sus variantes `.ps1`.

## Entrar como profesor o como estudiante

Al abrir la app aparece un menú de entrada:

- **Estudiante**: escribe su nombre y solo puede subir archivos y ver sus propias entregas (métricas, sinopsis y, cuando el profesor termina, la nota y el feedback). Su nombre queda unido al archivo.
- **Profesor**: entra con el PIN acordado (`Felipebolano2026`; en el código solo va su hash, pero el repositorio es público, así que cámbialo si necesitas privacidad real) y ve la biblioteca completa con el nombre de cada estudiante, califica, elimina, importa/exporta, entrena el modelo y **edita la rúbrica** (puntos, frecuencia exigida, penalizaciones, herramientas obligatorias, duración, extra).

Es una separación de espacios dentro del mismo navegador, pensada para un aula o un equipo compartido: no hay cuentas ni servidor. Si cada estudiante trabaja en su equipo, puede descargar sus entregas (JSON con métricas y sinopsis) desde «Mis entregas» y el profesor las importa en Biblioteca; el audio se comparte aparte y se reconoce por su huella.

## Qué incluye

- **Laboratorio:** carga múltiple WAV/AIFF/FLAC, mediciones DSP en worker, reproducción con marcadores, espectrograma y comparación con una fuente de la biblioteca. Máximo 200 MB por archivo; cancelación y recuperación de errores sin perder el lote ya guardado.
- **Revisión humana:** presencia, ausencia o pendiente por herramienta; evidencia escrita; sinopsis y contexto; nota derivada de la rúbrica y ajuste manual independiente. Los comentarios no borran una nota manual y una etiqueta pendiente no se convierte en ausencia.
- **Biblioteca:** audio original, métricas y anotaciones en IndexedDB; deduplicación SHA-256, búsqueda, filtros, exportación JSON/CSV, importación validada y eliminación individual. El CSV incluye notas finales y su procedencia manual/calculada/pendiente.
- **Modelo local:** bosques aleatorios por herramienta, entrenamiento en worker y validación con tres particiones separadas por grabación de origen. Se guardan las matrices de confusión y el modelo. Las sugerencias se abstienen con resultados insuficientes y no cambian etiquetas ni notas.
- **Demos:** cuatro señales sintéticas para explorar limpieza, clics, saturación y envolventes invertidas. Se identifican y excluyen del entrenamiento real.
- **Diseño:** consola Sonora adaptable a móvil (objetivos táctiles de 44 px, métricas en dos columnas), movimiento discreto (marca que respira, medidores que suben, marcas que laten; se apaga con «reducir movimiento»), fuentes y estilos locales, navegación por teclado e impresión del informe.
- **Motores de IA (profesor):** elige entre el modelo local gratuito o Gemini, Claude, OpenAI u OpenRouter con tu clave; comprueba la conexión con **Probar**; ve ventajas, límites y coste por evaluación; decide si los estudiantes reciben una lectura orientativa (una por entrega, con tu clave) y cuántas ejecuciones usa tu segunda opinión. Dos modos que se aplican a todos tus estudiantes: **modo de análisis** (escucha independiente o *refuerzo del modelo local*, en el que la IA recibe las sugerencias del clasificador y tus decisiones y las confirma o refuta con evidencia) y **redacción del feedback** (borrador local o redactado por la IA a partir de tu revisión cerrada, sin añadir detecciones).
- **OpenRouter:** una sola clave para Gemini, GPT Audio y un modelo gratuito (Nemotron 3 Nano Omni) que escucha y ve el espectrograma. Ojo: OpenRouter exige al menos 0,50 $ de saldo para enviar audio, incluso a modelos gratuitos; sin saldo la app reintenta con espectrograma + métricas y lo avisa. El redactor de feedback funciona sin saldo.
- **Evidencias con tiempos:** cada punto de la evaluación aparece con su momento, criterio, detalle y fuente (medido en el archivo, anotado por el profesor o sugerido por un modelo), pintado sobre la forma de onda; al pulsar una fila se escucha desde ahí. Las anotaciones del profesor con tiempos («0:12–0:18») y las sugerencias del modelo con marcas se convierten en regiones.

## Empezar sin muestras etiquetadas

1. Prueba una demo para conocer las mediciones y la revisión.
2. Reúne grabaciones reales y conserva sus originales; exporta versiones con y sin cada efecto.
3. Carga el lote en Biblioteca. Asigna el mismo **grupo de grabación de origen** al original y a todas sus versiones.
4. Etiqueta lo que puedas verificar y anota dónde ocurre. Lo incierto permanece pendiente.
5. Consulta **Modelo local** para ver cobertura y requisitos. El mínimo inicial por herramienta es 12 muestras, 6 orígenes y presencia/ausencia en al menos 3 orígenes por clase. Esto habilita un experimento; no garantiza robustez.

La aplicación se entrega **sin un modelo entrenado con trabajos reales**. Para empezar hay un corpus generado con etiquetas exactas en [corpus/](corpus/README.md) (grabaciones de dominio público procesadas por script; `npm run corpus:fetch` y `npm run corpus:build` lo regeneran) y su validación en [corpus/VALIDACION.md](corpus/VALIDACION.md). Consulta [la guía de muestras y validación](docs/MUESTRAS-Y-VALIDACION.md) para construir la colección real.

## Datos y ayudas externas

El JSON de colección contiene métricas y etiquetas, **no los archivos de audio ni el modelo**. Guarda los originales por separado y exporta periódicamente la colección. Puedes volver a cargar un original después de importar: su huella lo vincula al registro conservando las correcciones. Limpiar los datos del navegador elimina la biblioteca local; no hay servidor, sincronización ni copia en la nube.

La clave se guarda desde **Motores de IA** (una por proveedor, solo en ese navegador, sin `.env`) y el botón **Probar** verifica la conexión. En Gemini genera una respuesta breve con el modelo seleccionado (puede consumir cuota); no informa del saldo ni presenta el primer modelo del catálogo como si fuera el elegido. La clave, la elección de motor/modelo y sus comprobaciones se guardan automáticamente. Si el navegador rechaza la escritura, se avisa de que solo permanecen en la sesión. Cambiar la clave o el modelo invalida y cancela la comprobación anterior. Usa la misma dirección de la app para recuperar los ajustes. En una muestra, abre **Ver asistentes** y pulsa **Pedir segunda opinión** para iniciar la consulta. Gemini/OpenAI reciben audio preparado; Claude recibe imágenes y métricas. También se envían nombre, sinopsis y contexto. La interfaz explica los datos y el coste orientativo antes de consultar. El prompt (`services/llm/prompt.ts`) explica al modelo la rúbrica activa, un protocolo de escucha, cómo calibrar la confianza y el contrato de cada campo, y cambia de tono según lea el profesor (revisión) o el estudiante (lectura orientativa sin nota).

Los adaptadores de Gemini (audio, modos profesor y estudiante) y OpenRouter (reintento sin audio, modo refuerzo y redacción de feedback con el modelo gratuito) se han probado con credenciales reales; OpenAI y Anthropic conservan sus adaptadores sin llamadas facturables en esta validación. Para desarrollo local puedes dejar llaves por defecto en `.env.local` (ignorado por git) como `SONORA_DEV_KEY_OPENROUTER=…`: solo se cargan con `npm run dev`, nunca en el build. Las decisiones de diseño están en `docs/superpowers/specs/2026-09-07-openrouter-modos-feedback-design.md`. Una instalación pública o compartida necesitaría su propio backend de autenticación y gestión de claves.

## Límites de las mediciones y del aprendizaje

WAV/AIFF PCM se leen en su frecuencia original. AIFF utiliza una copia WAV float32 para reproducirse sin alterar las métricas ni el original. FLAC conserva frecuencia y profundidad desde STREAMINFO y depende del decodificador del navegador. Los formatos o tasas no admitidos producen un error explícito.

Clipping, clics y envolventes de reversa son detectores con límites; sus marcas deben escucharse. Las propuestas para detectar la reversa de verdad (comparación contra la fuente, declaración del estudiante, descriptores locales y firma de la reverberación) están en [docs/REVERSA-PROPUESTAS.md](docs/REVERSA-PROPUESTAS.md). Las pruebas sintéticas no equivalen a certificación de conformidad EBU/ITU. Los descriptores globales del modelo no demuestran que se aplicó pitch shift, time stretch o un filtro, ni localizan sus intervalos. Para verificar procesos ambiguos se necesita la fuente, el proyecto o evidencia del proceso de edición.

## Muestras, tutoriales y feedback local

- **Muestras** (menú del profesor): el corpus publicado en `public/corpus/` (50 grabaciones CC0 o de dominio público × 18 variantes = 900 muestras con etiqueta exacta). Se pueden escuchar el original y una versión por herramienta (MP3 de 12 s a 16 kHz), ver la cadena de procesos de cada variante, importar la colección a la biblioteca y cargar el modelo entrenado con ella, con su validación por grabación de origen. Se regenera con `npm run corpus:build` y `npm run corpus:model`; `npm run corpus:tune` compara hiperparámetros del bosque.
- **Guía de uso**: tutorial paso a paso para profesor y estudiante dentro de la app (también desde la pantalla de entrada) y en [docs/GUIA-PROFESOR.md](docs/GUIA-PROFESOR.md) y [docs/GUIA-ESTUDIANTE.md](docs/GUIA-ESTUDIANTE.md).
- **Redactar borrador**: el feedback se redacta en el navegador a partir de mediciones, etiquetas y evidencias, sin IA externa. Las alternativas (banco de comentarios, LLM pequeño en el navegador, pulido externo) están en [docs/FEEDBACK-LOCAL.md](docs/FEEDBACK-LOCAL.md).

## Publicación y contribuciones

- **App publicada**: https://egtorres14.github.io/sonora/ (GitHub Pages; se despliega sola con cada push a `main` mediante `.github/workflows/deploy.yml`). Todo sigue ejecutándose en el navegador: no hay servidor ni claves.
- **Contribuir muestras**: abre un issue con la plantilla *Contribuir muestras al corpus* y adjunta el JSON exportado desde Biblioteca (y, si quieres, un ZIP con el audio). Un flujo automático valida el esquema, descarta duplicados, abre un pull request con los registros en `corpus/contributions/` y guarda el audio en la release `corpus-audio`.
- **Modelo comunitario**: al fusionar cambios en el corpus, `corpus.yml` entrena el modelo con el código de la app y publica `community-model.json` y la validación en la release `modelo-comunitario`. El modelo que carga la app desde **Muestras** es `public/corpus/modelo.json`, regenerado con `npm run corpus:model`.

## Código y estado

| Ruta | Responsabilidad |
|---|---|
| `services/audio/` | Decodificación, DSP, demos, worker y espectrograma |
| `services/review.ts`, `services/scoring/` | Revisión humana y rúbrica; criterios editables en código |
| `services/library*.ts` | Persistencia, importación validada y exportación |
| `services/learning/` | Descriptores, particiones por origen, modelo y worker |
| `services/llm/` | Proveedores opcionales, consenso y catálogo |
| `components/workspace/` | Laboratorio, biblioteca, muestras, motores y aprendizaje |
| `components/GuideView.tsx`, `docs/GUIA-*.md` | Tutoriales de profesor y estudiante (en la app y en Markdown) |
| `services/corpus.ts`, `public/corpus/` | Corpus publicado: índice, colección importable, modelo entrenado y extractos MP3 |
| `services/feedback.ts` | Borrador de feedback determinista a partir de evidencias ([alternativas](docs/FEEDBACK-LOCAL.md)) |
| `tests/`, `tests/e2e/` | Pruebas de lógica y recorridos en Chromium |
| `scripts/corpus/`, `scripts/contrib/` | Generación del corpus, evaluación y flujos de contribución |
| `.github/` | Despliegue en Pages, CI, ingesta de contribuciones y modelo comunitario |

La [auditoría](docs/AUDITORIA.md) conserva el diagnóstico anterior; su actualización inicial describe el estado actual. La implementación y las comprobaciones se registran en [el plan](docs/superpowers/plans/2026-09-07-laboratorio-local.md).
