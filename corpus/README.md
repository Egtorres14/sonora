# Corpus de entrenamiento generado

Colección de muestras con **etiquetas exactas por construcción**: cada archivo es una grabación fuente de dominio público o CC0 a la que un script aplica procesos conocidos (pitch shift, time stretch, reversa, filtros, loops) y distractores (reverb, delay, ganancia, saturación, trémolo, ruido). Como el proceso lo aplica el script, no hay duda sobre qué se hizo ni dónde.

## Archivos

| Ruta | Contenido |
|---|---|
| `sources/catalog.json` | Fuentes candidatas: URL directa, licencia, atribución, página de origen |
| `sources/manifest.json` | Fuentes realmente descargadas (lo escribe `npm run corpus:fetch`) |
| `sources/files/` | Audio original descargado (no se versiona) |
| `coleccion.json` | Colección importable en **Biblioteca → Importar colección JSON**; contiene métricas y etiquetas, no audio |
| `indice.json` | Lista de variantes con su cadena de proceso, grupo y etiquetas |
| `audio/` | WAV de cada variante (16 bit, mono, frecuencia de la fuente) para escuchar o volver a cargar en la app (no se versiona) |

## Cómo se genera

```sh
npm run corpus:fetch    # descarga las fuentes de sources/catalog.json y escribe manifest.json
npm run corpus:build    # genera public/corpus/{coleccion,indice}.json y audio/*.mp3 (18 variantes por fuente)
npm run corpus:model    # entrena el modelo con la colección (+ contribuciones) y escribe public/corpus/modelo.json
npm run corpus:tune     # compara hiperparámetros del bosque con la misma validación por grupos
```

Opciones de `scripts/corpus/build-corpus.ts`: `--clip 20` (segundos por variante), `--seed 1` (reproducibilidad), `--wav none|all` (WAV completos), `--mp3` y `--mp3-seconds 12` (extractos de escucha), `--per-tool 2` (variantes por herramienta), `--max N` (primeras N fuentes).

Por cada fuente (= un `sourceGroup`): original recortado, dos variantes por herramienta con ajustes distintos, cuatro combinaciones de 2–3 herramientas (a veces con un distractor) y tres variantes solo con distractores. Los niveles de salida se varían (−1 a −9 dBFS) para que el nivel no sea una pista. `extra` se marca "presente" cuando hay reverb, delay o trémolo; `sobreprocesamiento` se marca leve/moderado en transposiciones de una octava, estiramientos extremos o saturación.

## Qué es y qué no es

- Es una colección **real en cuanto a fuente y proceso**, no trabajos de estudiantes. Los procesos son los de un DAW sencillo (phase vocoder 2048/512, remuestreo lineal, filtros RBJ), con sus artefactos. Un estudiante puede usar algoritmos mejores o peores.
- Las fuentes tienen procedencia y licencia registradas en cada registro (`notes`). Conserva el `catalog.json` como registro de atribución.
- Si al cargar en la app un WAV de `audio/`, su huella SHA-256 coincide con el registro importado y se vinculan.
- La validación por grupos de la app garantiza que las versiones de una misma grabación no se reparten entre entrenamiento y evaluación. Aun así, el corpus mide **si el modelo distingue estos procesos sobre estas fuentes**, no su rendimiento sobre proyectos reales: reserva grabaciones nuevas (idealmente trabajos reales etiquetados) para una evaluación final.
- Los descriptores del modelo son globales (espectro promedio, dinámica, envolvente). Es esperable que detecten bien filtros y reversa, regular loops, y mal pitch shift y time stretch sobre una única mezcla. Ese resultado, si aparece, es información honesta sobre el método, no un fallo del corpus.
