# Gemini: comprobación y persistencia

La prueba anterior solicitaba modelos y mostraba el primero (2.5 Flash), aunque el selector indicara 3.8 Flash. La generación de comprobación usaba 3.5 Flash-Lite con un token y no exigía recibir texto. Esto no comprobaba el modelo elegido ni demostraba el saldo del proyecto.

Ahora «Probar» genera una respuesta breve con el modelo seleccionado, permite espacio para el razonamiento y exige texto no vacío. El resultado indica el modelo probado y el alcance de la prueba. Los errores de modelo, credenciales, cuota y red se distinguen, y se omite la clave de cualquier mensaje del proveedor.

La clave, el modelo, el motor y las comprobaciones se guardan automáticamente. Antes solo la clave se escribía al editar; la selección y el resultado dependían del botón inferior. Se comprueba la escritura en localStorage y se informa si solo existe una copia en memoria. La copia de sesión sigue disponible al navegar aunque el almacenamiento falle. Cambiar clave o modelo cancela su prueba y elimina el resultado anterior; desmontar la pantalla cancela las pruebas activas. Borrar una clave no hace reaparecer la predeterminada de desarrollo.

## Verificación con Google

Pruebas realizadas el 07/09/2026 con la credencial proporcionada por el usuario; la credencial no se guardó en archivos del proyecto ni en este informe.

- El listado autenticado incluía `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.5-flash-lite` y `gemini-3.1-pro-preview`.
- Los cuatro aceptaron una petición de generación. Con un límite inicial de 32 tokens, 3.8 agotó el presupuesto de razonamiento sin producir texto: esa respuesta no se contó como prueba de generación completa.
- 3.8 Flash y 3.5 Flash-Lite devolvieron JSON completo al recibir un WAV sintético de un segundo y un esquema estructurado; la API confirmó tokens de entrada de audio y `STOP`.
- La función corregida `testKey`, ejecutada con el SDK real, confirmó texto en ambos modelos con el presupuesto corregido de 512 tokens.

Estas comprobaciones demuestran acceso y funcionamiento de las modalidades probadas. No validan la exactitud de las descripciones musicales ni miden el saldo. El WAV era un tono sintético; las descripciones obtenidas fueron interpretativas, de modo que no se usan como evidencia de precisión del evaluador.

Las pruebas automatizadas usan credenciales ficticias y respuestas simuladas. Cubren modelo seleccionado, respuesta vacía, clasificación de errores, omisión de secretos, fallo de almacenamiento, eliminación de claves de desarrollo y persistencia al navegar/recargar. Los E2E de claves no generan trazas ni capturas para evitar registrar posibles claves de desarrollo inyectadas por Vite.

Referencia del modelo actual: [Gemini 3.8 Flash, documentación de Google](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).
