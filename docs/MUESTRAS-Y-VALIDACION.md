# Construir una colección verificable

Estado inicial: no hay muestras reales etiquetadas ni un modelo validado en el dominio de uso. Las demos de Sonora son material didáctico sintético, no evidencia de rendimiento.

## Unidad de origen y etiquetas

Una grabación independiente y todas sus versiones pertenecen al mismo `sourceGroup`. Dos recortes de una sesión o transformaciones de un mismo archivo no deben repartirse entre entrenamiento y evaluación. Usa nombres estables, por ejemplo `campana-sala-a-toma-01`. Los nombres se normalizan quitando espacios exteriores y pasando a minúsculas.

Para cada herramienta (`pitch_shift`, `time_stretch`, `reversa`, `filtros`, `loops`) marca:

- `present`: tienes evidencia de que se aplicó el proceso.
- `absent`: sabes que no se aplicó; incluye ejemplos negativos que puedan parecer positivos.
- `unknown`: no puedes verificarlo. El modelo excluye esa etiqueta para esa herramienta.

En Evidencia escribe intervalo, ajustes y cómo lo verificaste: por ejemplo, `00:12–00:18; +5 semitonos; contrastado con exportación del proyecto`. Conserva original, exportación procesada y proyecto o registro de ajustes en tu archivo de trabajo. Sonora guarda evidencia escrita, pero no verifica automáticamente la veracidad de esa anotación.

## Preparación práctica

1. Graba fuentes variadas: voces, instrumentos, percusión, ambientes y texturas, con distintas sesiones y condiciones.
2. Conserva una versión sin procesar. Produce primero pares controlados, cambiando una herramienta cada vez; después incluye cadenas y mezclas más complejas.
3. Evita asociar una clase a una única frecuencia de muestreo, programa, micrófono o nivel. Un modelo podría aprender ese detalle en lugar del proceso buscado.
4. Sube originales y versiones en lotes. El contenido idéntico se deduplica, aunque cambie el nombre. Versiones casi idénticas requieren el mismo grupo: SHA-256 no identifica parentesco acústico.
5. Revisa las etiquetas con escucha, comparación y registros del proyecto. Si hay desacuerdo, deja la muestra pendiente hasta resolverlo; no copies la salida de una IA como verdad de entrenamiento.
6. Exporta el JSON de colección y guarda los audios originales por separado. El CSV sirve para revisar etiquetas y notas; no es el formato de importación.

El JSON admite hasta 10.000 registros y 50 MB por importación. El audio se procesa secuencialmente; el espacio total depende de la cuota del navegador y del dispositivo. Estos límites no son una prueba de rendimiento con 10.000 audios reales.

## Qué hace el modelo implementado

Se entrena un bosque aleatorio independiente por herramienta: 40 árboles, semilla 42 y profundidad máxima 8. Usa un resumen del espectro alineado a una rejilla común (48 bandas, 30 Hz–16 kHz), descriptores de energía y dinámica y, desde la versión `spectrum-temporal-v2`, descriptores temporales: asimetría de las envolventes alrededor de los picos (natural > 0, reversa < 0), periodicidad de la envolvente, fracción de bloques de 20 ms que se repiten de forma idéntica a un lag fijo (loops copiados digitalmente; un tono perfectamente periódico también puntúa alto) y cresta del flujo espectral (transitorios emborronados). No usa el nombre del archivo ni las notas como predictores. Los registros exportados con la versión de características `2.0.0` deben reanalizarse: la biblioteca los rechaza al importar.

El mínimo de 12 muestras y 6 grupos, con cada clase representada en al menos 3 grupos, es una regla de habilitación del proyecto. El programa exige también que cada partición de entrenamiento contenga ambas clases. No es un tamaño de muestra estadísticamente certificado.

Cada origen se retiene una vez en una validación de tres particiones. Ninguna de sus versiones entra en el entrenamiento que lo evalúa. Se acumulan verdaderos positivos/negativos y falsos positivos/negativos; se muestran precisión positiva, sensibilidad y exactitud equilibrada. La separación por grupos sigue el principio descrito en la [documentación de validación cruzada de scikit-learn](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data); el algoritmo de reparto aquí es propio.

Después de validar, el modelo final se ajusta con todos los registros elegibles y se guarda con sus identificadores. La interfaz evita mostrar predicciones sobre muestras o grupos usados en el entrenamiento. Si se elimina o modifica una muestra utilizada, las sugerencias se deshabilitan hasta reentrenar.

El porcentaje de votos de los árboles **no es una probabilidad calibrada**. El prototipo se abstiene si la exactitud equilibrada retenida es menor de 0,65 o el voto queda entre 0,35 y 0,65. Estos umbrales son decisiones experimentales, no garantías de fiabilidad. El clasificador usa [ml-random-forest](https://github.com/mljs/random-forest).

## Qué falta para afirmar robustez

Reunir y revisar el corpus real, ampliar su diversidad, analizar errores por herramienta y por tipo de fuente, y reservar grabaciones nuevas para una evaluación final independiente. Si ajustas descriptores o umbrales mirando los resultados, conserva otra colección sin usar para comprobar el resultado final.

Las métricas actuales no incluyen intervalos de confianza ni una evaluación externa. El modelo puede abstenerse y aun así equivocarse cuando sí sugiere algo. Si los descriptores globales no separan procesos sutiles, habrá que añadir análisis temporal y comparación entre fuente y resultado, comprobando cada cambio sobre los mismos grupos de evaluación. Acumular muchas versiones de pocas grabaciones no reemplaza la diversidad de orígenes.

Los fixtures de pruebas automáticas contienen descriptores controlados para comprobar el programa; sus resultados no deben publicarse como precisión del sistema sobre música o trabajos de estudiantes.

## Corpus generado con etiquetas exactas

Mientras no exista una colección real de trabajos, `corpus/` contiene 600 registros construidos a partir de 50 grabaciones de dominio público / CC0 procesadas por `scripts/corpus/build-corpus.ts` (pitch shift, time stretch, reversa, filtros, loops y distractores). Sus etiquetas son exactas porque el proceso lo aplica el script. Sirve para comprobar que el modelo separa estos procesos sobre fuentes variadas; sus cifras (`corpus/VALIDACION.md`) no son rendimiento sobre proyectos de estudiantes. Importa `corpus/coleccion.json` en Biblioteca y entrena para reproducirlas; evalúa después con grabaciones nuevas que no hayan pasado por el generador.
