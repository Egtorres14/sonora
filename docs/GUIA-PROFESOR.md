# Guía del profesor

Sonora es un laboratorio de audio que corre entero en el navegador. Recibe los proyectos de tus estudiantes, los mide con DSP real, te ayuda a confirmar qué procesos creativos aparecen y calcula la nota con una rúbrica editable. Nada sale de tu equipo salvo que tú pidas una segunda opinión a un proveedor externo.

La misma guía está dentro de la app, en **Guía de uso** (menú lateral) y en la pantalla de entrada.

## 1. Entrar

1. Abre la app (en GitHub Pages o en local con `npm run dev`).
2. Elige **Profesor** e introduce el PIN. La sesión queda guardada en ese navegador hasta que pulses **Salir**.
3. En un equipo compartido con estudiantes, cierra sesión al terminar: el PIN separa los espacios, pero no protege frente a quien borre los datos del navegador.

## 2. Recibir y subir audios

- **Laboratorio**: arrastra archivos WAV, AIFF o FLAC (hasta 200 MB cada uno). Se analizan en un *worker* del navegador y se guardan en IndexedDB.
- **Biblioteca**: aquí aparecen todas las muestras. Las entregas de estudiantes muestran su nombre, la fecha y si la nota ya está publicada.
- Un mismo archivo se reconoce por su huella SHA-256: si un estudiante lo vuelve a subir no se duplica.
- Las demos sintéticas (campana limpia, con clics, en reversa) sirven para explorar la interfaz; quedan excluidas del entrenamiento.

## 3. Leer las mediciones

Cada archivo muestra:

| Medición | Qué es | Cómo puntúa |
|---|---|---|
| Loudness integrado, corto y momentáneo (LUFS) | ITU-R BS.1770-4 / EBU R128 con *gating* | Informativa |
| Pico real (dBTP) | Sobremuestreo ×4 | Informativa; el clipping penaliza |
| Saturación | Rachas de muestras a fondo de escala | Penaliza según la rúbrica |
| Clics y discontinuidades | Residuo LPC + detector de saltos | Penaliza por tramos |
| Silencios internos | Tramos sin señal | Pista |
| Espectro y ancho de banda | FFT por bloques | Informativa |
| Formato | Frecuencia de muestreo, bits, canales, duración | Puntúa según la rúbrica |

Las mediciones son reproducibles: el mismo archivo da siempre el mismo resultado. Todas aparecen en la línea de tiempo del panel **Dónde ocurre cada cosa**; pulsa una marca o una fila para escuchar ese momento.

## 4. Confirmar las herramientas

En **Criterio del profesor** marca para cada herramienta (pitch shift, time stretch, reversa, filtros, loops) si está **presente**, **ausente** o **pendiente**.

- Escribe la evidencia con tiempos, por ejemplo `0:12–0:18 sube una octava`. Se dibuja en la línea de tiempo y se cita en el feedback.
- Si tienes la fuente original en la biblioteca, elígela como referencia en el panel de contexto para comparar A/B.
- Mientras haya decisiones pendientes la nota queda **En revisión** y se muestra el rango posible.
- Sobreprocesamiento y efectos extra se deciden en el mismo panel.

## 5. Pedir una segunda opinión

En **Motores de IA** decides quién opina y cuánto cuesta:

- **Modelo local** (por defecto): bosque aleatorio entrenado en tu navegador. Gratis y privado; se abstiene cuando no está seguro. Solo tú ves sus sugerencias.
- **Gemini, Claude u OpenAI** con tu clave: reciben las mediciones y la sinopsis, nunca el audio. Puedes elegir modelo, número de ejecuciones (mayoría de 3 o 5) y si los estudiantes pueden pedir una lectura orientativa con tu presupuesto.

Ninguna sugerencia cambia etiquetas ni notas: solo señala dónde mirar.

## 6. Redactar el feedback y publicar

1. Pulsa **Redactar borrador** debajo del campo de feedback. Se genera en tu navegador, sin IA externa, a partir de las mediciones, tus etiquetas y tus evidencias. Edítalo con libertad.
2. Cuando la revisión esté completa, pulsa **Publicar al estudiante**. En **Mis entregas** verá la nota, el desglose y tu comentario.
3. Puedes ajustar la nota a mano; queda marcada como ajustada.

## 7. Ajustar la rúbrica

En **Rúbrica** cambias los puntos de cada bloque (formal, técnico, creativo), las penalizaciones, las herramientas obligatorias y la bonificación. Se guarda en el navegador y todas las notas se recalculan al instante. **Restablecer** vuelve a la original.

## 8. Muestras y modelo local

- **Muestras** lista el corpus publicado: 50 grabaciones de dominio público o CC0 con 18 variantes cada una (900 muestras) generadas por el proyecto, con etiqueta exacta de cada proceso. Puedes escuchar el original y una versión por herramienta, ver la cadena de procesos y filtrar por categoría.
- **Importar corpus a la biblioteca** añade las mediciones y etiquetas (no el audio) y **carga el modelo entrenado** con esa colección, con su validación por grabación de origen.
- **Modelo local** muestra la cobertura de tu colección y permite reentrenar con tus propias muestras verificadas. Requisitos mínimos por herramienta: 12 muestras reales, 6 orígenes y ambas clases en al menos 3 orígenes.
- La validación separa por grabación de origen: ninguna variante se evalúa con un modelo que la haya visto. Las cifras describen el corpus, no tus trabajos reales; para eso, añade y etiqueta grabaciones de tu clase.

## 9. Exportar y contribuir

- **CSV** desde Biblioteca: una fila por archivo con estudiante, fecha, etiquetas, nota y tipo de nota. Se abre en Excel o Sheets.
- **JSON**: la colección completa (sin audio) para llevarla a otro equipo o importarla en otro navegador.
- **Contribuir al corpus**: abre un issue con la plantilla «Contribuir muestras» y adjunta el JSON. Un flujo automático valida el esquema, deduplica y abre un PR; al fusionarlo se reentrena el modelo comunitario.

## Qué mide y qué no

Las mediciones técnicas son exactas. La detección de procesos creativos es siempre una sugerencia que confirmas tú: el modelo local se abstiene cuando no está seguro y los proveedores externos opinan, no deciden. Para procesos sutiles (una reversa por segmentos, un *time stretch* leve) compara con la fuente original: es la única prueba fiable.
