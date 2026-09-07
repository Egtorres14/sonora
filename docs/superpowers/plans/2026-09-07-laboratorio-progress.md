# SDD ledger — plan: docs/superpowers/plans/2026-09-07-laboratorio-local.md

Ruling: la copia no tiene Git; respaldo y revisión de archivos sustituyen worktrees/commits/diff de rama. Autorización explícita para implementar, no se solicita aprobación adicional del diseño.

| Interfaz/tarea | Comprobación |
|---|---|
| Revisión → biblioteca | Mismo registro con etiquetas ternarias y grupo de origen. |
| Biblioteca → ML | ML consume métricas y etiquetas humanas, excluye demos. |
| IA → revisión | Solo sugerencia; ninguna escritura automática de etiquetas. |
| Revisión → UI | Total pendiente o manual explícito, desglose siempre derivado. |
| Pruebas → ML | Datos separados por origen, no accuracy de entrenamiento. |

En curso: núcleo local, correcciones y entrenamiento independiente.
