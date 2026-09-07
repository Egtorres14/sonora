# Sonora: laboratorio local de evaluación

La solicitud autoriza corregir fallos, hacer opcional la IA externa, incorporar muestras y aprendizaje automático local y rediseñar la interfaz.

## Decisiones

- La evaluación principal funciona sin claves ni red: DSP, reproducción con marcadores, espectrograma, etiquetas del profesor y rúbrica.
- Las herramientas creativas tienen tres estados: presente, ausente y pendiente. Pendiente nunca equivale a ausente y no produce una nota final automática.
- Las correcciones humanas recalculan el desglose; una nota manual explícita se conserva al editar comentarios y se elimina únicamente con su control de restablecer.
- La IA externa es una segunda opinión solicitada expresamente. Sus resultados y las predicciones locales no se convierten en etiquetas de entrenamiento ni decisiones humanas.
- Biblioteca local en IndexedDB con audio, SHA-256, métricas, etiquetas, evidencia temporal, procedencia real/sintética y grupo de grabación de origen. Carga múltiple secuencial, errores por archivo, deduplicación y exportación/importación de métricas y etiquetas.
- Modelo base de bosques aleatorios por herramienta sobre descriptores locales. Entrenamiento y validación fuera del hilo de interfaz. Evaluación con grupos de origen separados, positivos y negativos, y resultados por clase. Nunca se presenta el porcentaje de votos como certeza calibrada.
- Las muestras sintéticas sirven para demostración y regresiones; no se usan para presentar una validación de rendimiento real. El modelo empieza sin entrenar.
- UI: Sonora, consola de estudio en grafito y marfil, acento lima suave, tipografía Barlow Condensed e IBM Plex, números monoespaciados, medidores, forma de onda, navegación lateral y biblioteca tabular. Responsive, teclado, reduced motion, estilos y fuentes locales.

## Alternativas consideradas

1. Solo DSP: exacto para las mediciones implementadas, insuficiente para inferir todos los procesos creativos.
2. DSP + revisión humana + clasificador local (elegida): permite trabajar ya y aprender con datos etiquetados y validación medible.
3. Red neuronal de audio: requiere un corpus y evaluación independientes que todavía no existen; no se simulará una robustez no demostrada.

## Alcance de la entrega

Flujo local completo, biblioteca, aprendizaje base real, segunda opinión opcional, correcciones y verificación. La precisión sobre trabajos reales depende del corpus del usuario. Despliegue multiusuario y alojamiento de claves de terceros no forman parte de este laboratorio local.
