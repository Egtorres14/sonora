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
- **Profesor**: entra con un PIN (se crea la primera vez en cada navegador) y ve la biblioteca completa con el nombre de cada estudiante, califica, elimina, importa/exporta, entrena el modelo y **edita la rúbrica** (puntos, frecuencia exigida, penalizaciones, herramientas obligatorias, duración, extra).

Es una separación de espacios dentro del mismo navegador, pensada para un aula o un equipo compartido: no hay cuentas ni servidor. Si cada estudiante trabaja en su equipo, puede descargar sus entregas (JSON con métricas y sinopsis) desde «Mis entregas» y el profesor las importa en Biblioteca; el audio se comparte aparte y se reconoce por su huella.

## Qué incluye

- **Laboratorio:** carga múltiple WAV/AIFF/FLAC, mediciones DSP en worker, reproducción con marcadores, espectrograma y comparación con una fuente de la biblioteca. Máximo 200 MB por archivo; cancelación y recuperación de errores sin perder el lote ya guardado.
- **Revisión humana:** presencia, ausencia o pendiente por herramienta; evidencia escrita; sinopsis y contexto; nota derivada de la rúbrica y ajuste manual independiente. Los comentarios no borran una nota manual y una etiqueta pendiente no se convierte en ausencia.
- **Biblioteca:** audio original, métricas y anotaciones en IndexedDB; deduplicación SHA-256, búsqueda, filtros, exportación JSON/CSV, importación validada y eliminación individual. El CSV incluye notas finales y su procedencia manual/calculada/pendiente.
- **Modelo local:** bosques aleatorios por herramienta, entrenamiento en worker y validación con tres particiones separadas por grabación de origen. Se guardan las matrices de confusión y el modelo. Las sugerencias se abstienen con resultados insuficientes y no cambian etiquetas ni notas.
- **Demos:** cuatro señales sintéticas para explorar limpieza, clics, saturación y envolventes invertidas. Se identifican y excluyen del entrenamiento real.
- **Diseño:** consola Sonora adaptable a móvil, fuentes y estilos locales, navegación por teclado, movimiento reducido e impresión del informe.

## Empezar sin muestras etiquetadas

1. Prueba una demo para conocer las mediciones y la revisión.
2. Reúne grabaciones reales y conserva sus originales; exporta versiones con y sin cada efecto.
3. Carga el lote en Biblioteca. Asigna el mismo **grupo de grabación de origen** al original y a todas sus versiones.
4. Etiqueta lo que puedas verificar y anota dónde ocurre. Lo incierto permanece pendiente.
5. Consulta **Modelo local** para ver cobertura y requisitos. El mínimo inicial por herramienta es 12 muestras, 6 orígenes y presencia/ausencia en al menos 3 orígenes por clase. Esto habilita un experimento; no garantiza robustez.

La aplicación se entrega **sin un modelo entrenado con trabajos reales**. Para empezar hay un corpus generado con etiquetas exactas en [corpus/](corpus/README.md) (grabaciones de dominio público procesadas por script; `npm run corpus:fetch` y `npm run corpus:build` lo regeneran) y su validación en [corpus/VALIDACION.md](corpus/VALIDACION.md). Consulta [la guía de muestras y validación](docs/MUESTRAS-Y-VALIDACION.md) para construir la colección real.

## Datos y ayudas externas

El JSON de colección contiene métricas y etiquetas, **no los archivos de audio ni el modelo**. Guarda los originales por separado y exporta periódicamente la colección. Puedes volver a cargar un original después de importar: su huella lo vincula al registro conservando las correcciones. Limpiar los datos del navegador elimina la biblioteca local; no hay servidor, sincronización ni copia en la nube.

En una muestra, abre **Ver asistentes → Consultar una IA externa** y añade tu clave si deseas una segunda opinión. Solo el botón **Pedir segunda opinión** inicia la consulta. Gemini/OpenAI reciben audio preparado; Claude recibe imágenes y métricas. También se envían nombre, sinopsis y contexto. La interfaz explica los datos y el coste orientativo antes de consultar. Las claves no se incorporan desde `.env` y recordarlas está desactivado por defecto.

Los adaptadores externos se conservan, pero no se han probado llamadas facturables con credenciales reales en esta validación. Una instalación pública o compartida necesitaría su propio backend de autenticación y gestión de claves.

## Límites de las mediciones y del aprendizaje

WAV/AIFF PCM se leen en su frecuencia original. AIFF utiliza una copia WAV float32 para reproducirse sin alterar las métricas ni el original. FLAC conserva frecuencia y profundidad desde STREAMINFO y depende del decodificador del navegador. Los formatos o tasas no admitidos producen un error explícito.

Clipping, clics y envolventes de reversa son detectores con límites; sus marcas deben escucharse. Las propuestas para detectar la reversa de verdad (comparación contra la fuente, declaración del estudiante, descriptores locales y firma de la reverberación) están en [docs/REVERSA-PROPUESTAS.md](docs/REVERSA-PROPUESTAS.md). Las pruebas sintéticas no equivalen a certificación de conformidad EBU/ITU. Los descriptores globales del modelo no demuestran que se aplicó pitch shift, time stretch o un filtro, ni localizan sus intervalos. Para verificar procesos ambiguos se necesita la fuente, el proyecto o evidencia del proceso de edición.

## Publicación y contribuciones

- **App publicada**: https://egtorres14.github.io/sonora/ (GitHub Pages; se despliega sola con cada push a `main` mediante `.github/workflows/deploy.yml`). Todo sigue ejecutándose en el navegador: no hay servidor ni claves.
- **Contribuir muestras**: abre un issue con la plantilla *Contribuir muestras al corpus* y adjunta el JSON exportado desde Biblioteca (y, si quieres, un ZIP con el audio). Un flujo automático valida el esquema, descarta duplicados, abre un pull request con los registros en `corpus/contributions/` y guarda el audio en la release `corpus-audio`.
- **Modelo comunitario**: al fusionar cambios en el corpus, `corpus.yml` entrena el modelo con el código de la app y publica `community-model.json` y la validación en la release `modelo-comunitario`. Cargar ese modelo desde la app es el siguiente paso pendiente.

## Código y estado

| Ruta | Responsabilidad |
|---|---|
| `services/audio/` | Decodificación, DSP, demos, worker y espectrograma |
| `services/review.ts`, `services/scoring/` | Revisión humana y rúbrica; criterios editables en código |
| `services/library*.ts` | Persistencia, importación validada y exportación |
| `services/learning/` | Descriptores, particiones por origen, modelo y worker |
| `services/llm/` | Proveedores opcionales, consenso y catálogo |
| `components/workspace/` | Laboratorio, biblioteca y aprendizaje |
| `tests/`, `tests/e2e/` | Pruebas de lógica y recorridos en Chromium |
| `scripts/corpus/`, `scripts/contrib/` | Generación del corpus, evaluación y flujos de contribución |
| `.github/` | Despliegue en Pages, CI, ingesta de contribuciones y modelo comunitario |

La [auditoría](docs/AUDITORIA.md) conserva el diagnóstico anterior; su actualización inicial describe el estado actual. La implementación y las comprobaciones se registran en [el plan](docs/superpowers/plans/2026-09-07-laboratorio-local.md).
