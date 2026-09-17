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
### Marcar dónde ocurre cada herramienta

Sobre la forma de onda, con «Marcar» activo, arrastra para señalar el tramo de una herramienta. Sin ratón: «Marcar desde el tiempo actual» crea una marca de un segundo desde el cursor y los tiempos se ajustan con los campos numéricos de la lista; ese camino funciona también en un registro importado que no trae audio.

Cada marca lleva su comentario y **encabeza la lista de evidencias**: si una herramienta tiene marcas, los tiempos salen de ellas y el campo de texto deja de parsearse. La primera marca de una herramienta pendiente la propone como «presente» y te avisa; borrarla **no** cambia la etiqueta, porque la decisión es tuya. El estudiante no ve ninguna marca hasta que publicas la revisión.

Sube el zoom a 200 o 400 px/s para marcar con precisión: a tamaño «Ajustar», en un archivo de un minuto, un píxel son decenas de milisegundos.

- **Gemini, Claude u OpenAI** con tu clave: reciben las mediciones y la sinopsis, nunca el audio. Puedes elegir modelo, número de ejecuciones (mayoría de 3 o 5) y si los estudiantes pueden pedir una lectura orientativa con tu presupuesto.

Ninguna sugerencia cambia etiquetas ni notas: solo señala dónde mirar.

## 6. Redactar el feedback y publicar

1. Pulsa **Redactar borrador** debajo del campo de feedback. Se genera en tu navegador, sin IA externa, a partir de las mediciones, tus etiquetas y tus evidencias. Edítalo con libertad.
2. Cuando la revisión esté completa, pulsa **Publicar al estudiante**. En **Mis entregas** verá la nota, el desglose y tu comentario.
3. Puedes ajustar la nota a mano; queda marcada como ajustada.

### La nota publicada se congela

Al pulsar **Publicar al estudiante** se guarda la nota y su desglose tal como están en ese momento, y eso es lo que ve el estudiante desde entonces. Si después cambias la rúbrica, retocas una etiqueta o el audio se vuelve a medir, tu cálculo cambia pero la nota publicada no: verás un aviso «Publicada X · ahora calcularía Y» con **Volver a publicar**, y en la biblioteca la marca «difiere de lo publicado». Retirar la publicación borra la instantánea. El CSV lleva las dos columnas, «Nota final» (cálculo vivo) y «Nota publicada».

## 7. Ajustar la rúbrica

En **Rúbrica** cambias los puntos de cada bloque (formal, técnico, creativo), las penalizaciones, las herramientas obligatorias y la bonificación. Se guarda en el navegador y todas las notas se recalculan al instante. **Restablecer** vuelve a la original.

### Formato del nombre de archivo

Escribe el formato tal como lo pondrías en el enunciado. Campos disponibles:

| Campo | Acepta |
|---|---|
| `{estudiante}` | Una palabra del nombre con el que entró el estudiante |
| `{numero}` | Uno o más dígitos |
| `{texto}` | Una palabra de letras o números |
| `*` | Cualquier cosa |

Por ejemplo, `{estudiante}_{estudiante}_ejercicio{numero}` acepta `perez_ana_ejercicio3.wav` de Ana Pérez. No distingue mayúsculas ni acentos, y el resto de caracteres se toma literalmente.

`{estudiante}` se comprueba contra el nombre registrado: si Ana Pérez entrega `lopez_ana_ejercicio3.wav`, el criterio no puntúa y el motivo lo dice («lopez» no forma parte del nombre registrado). Partículas como «de» o «la» no cuentan como parte del nombre.

Usa la caja **Probar un nombre** antes de guardar: te dice si un nombre puntuaría y por qué. El estudiante ve el formato y un ejemplo con su propio nombre **antes** de subir. Si dejas el campo vacío, se mantiene el criterio anterior: solo pierden puntos los nombres genéricos como «audio1» o «untitled».

## 8. Muestras y modelo local

- **Muestras** lista el corpus publicado: 50 grabaciones de dominio público o CC0 con 18 variantes cada una (900 muestras) generadas por el proyecto, con etiqueta exacta de cada proceso. Puedes escuchar el original y una versión por herramienta, ver la cadena de procesos y filtrar por categoría.
- **Importar corpus a la biblioteca** añade las mediciones y etiquetas (no el audio) y **carga el modelo entrenado** con esa colección, con su validación por grabación de origen.
- **Modelo local** muestra la cobertura de tu colección y permite reentrenar con tus propias muestras verificadas. Requisitos mínimos por herramienta: 12 muestras reales, 6 orígenes y ambas clases en al menos 3 orígenes.
- La validación separa por grabación de origen: ninguna variante se evalúa con un modelo que la haya visto. Las cifras describen el corpus, no tus trabajos reales; para eso, añade y etiqueta grabaciones de tu clase.

### Conjunto de evaluación congelado

El historial compara cada entrenamiento con el anterior, pero si la colección creció, el examen también cambió: una cifra mejor puede significar un examen más fácil. En **Modelo local**, **Congelar conjunto de evaluación** aparta una quinta parte de los orígenes (grabaciones enteras, nunca muestras sueltas; hacen falta al menos 8 orígenes reales). Esas muestras quedan fuera del entrenamiento y cada modelo se mide sobre ellas: la columna «Congelado» de la validación y la marca «congelado» del historial son la única comparación honesta entre dos modelos. Rehacer o quitar el conjunto rompe esa comparabilidad, y la aplicación lo avisa.

### Muestras de una versión anterior

Cuando la aplicación mejora la forma de medir, las muestras medidas antes siguen valiendo para la nota, pero no entran en el entrenamiento hasta medirse de nuevo. En **Modelo local** verás cuántas hay y un botón para reanalizar las que tienen audio guardado; también basta con abrir una de ellas. Las importadas sin audio se quedan como están: vuelve a subir el original y se reconocerá por su huella.

## 9. Exportar y contribuir

- **CSV** desde Biblioteca: una fila por archivo con estudiante, fecha, etiquetas, nota y tipo de nota. Se abre en Excel o Sheets.
- **JSON**: la colección completa (sin audio) para llevarla a otro equipo o importarla en otro navegador.
- **Contribuir al corpus**: abre un issue con la plantilla «Contribuir muestras» y adjunta el JSON. Un flujo automático valida el esquema, deduplica y abre un PR; al fusionarlo se reentrena el modelo comunitario.

## Qué mide y qué no

Las mediciones técnicas son exactas. La detección de procesos creativos es siempre una sugerencia que confirmas tú: el modelo local se abstiene cuando no está seguro y los proveedores externos opinan, no deciden. Para procesos sutiles (una reversa por segmentos, un *time stretch* leve) compara con la fuente original: es la única prueba fiable.
