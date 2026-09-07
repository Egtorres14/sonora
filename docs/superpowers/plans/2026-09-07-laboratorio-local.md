# Sonora Implementation Plan

**Goal:** Evaluar audio sin depender de proveedores externos y preparar un ciclo verificable de muestras, etiquetas, entrenamiento y revisión.
**Architecture:** React/Vite, DSP existente en worker, dominio local de revisión, IndexedDB, bosque aleatorio en worker; IA externa aislada mediante carga dinámica.
**Spec:** ../specs/2026-09-07-laboratorio-local-design.md

## Global Constraints

- Ninguna llamada externa automática ni claves en el bundle.
- Pendiente no equivale a ausente. Las sugerencias no modifican las etiquetas humanas.
- Validación separada por grupo de grabación; excluir muestras sintéticas de entrenamiento y validación de producción.
- No publicar cifras de precisión inventadas. Modelo inicial sin entrenar.
- UI en español, responsive, teclado, movimiento reducido, estilos locales.
- Esta carpeta no contiene Git. Trabajar sobre la copia autorizada, con respaldo local previo; no crear commits ficticios.

## Tasks

- [ ] 1. Corregir consenso, comandos de test/typecheck, formatos y recuperación de archivos; pruebas de regresión.
- [ ] 2. Dominio de revisión local: estados pendientes, rúbrica, evidencia y nota manual; pruebas de aritmética y persistencia.
- [ ] 3. Biblioteca IndexedDB, carga múltiple, deduplicación, exportación/importación validada y muestras de demostración.
- [ ] 4. Entrenamiento local supervisado y evaluación por grupos; pruebas con datos controlados, errores y fugas.
- [ ] 5. Rediseño de la consola y flujos de análisis/biblioteca/modelos; IA bajo demanda con SDKs cargados aparte.
- [ ] 6. Build, typecheck, suite, recorrido real en navegador escritorio/móvil y revisión independiente; actualizar README y estado.

## Verification

`npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e`.
Regresiones: WAV corrupto seguido de válido; consenso N/A; etiqueta humana cambia nota; comentarios preservan nota manual; pendiente produce rango; duplicados no entrenan dos veces; grupos nunca cruzan particiones; JSON inválido no altera biblioteca; persistencia tras recarga; UI usable a 390 px.
