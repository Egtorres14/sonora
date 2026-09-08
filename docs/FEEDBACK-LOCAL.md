# Feedback con el modelo local: qué se puede hacer sin IA externa

El modelo local es un clasificador (bosque aleatorio sobre descriptores de audio). Sabe decir «probablemente hay pitch shift», pero no escribe. Para dar feedback en texto sin depender de Gemini, Claude u OpenAI hay cuatro caminos con distinto coste y calidad. El primero ya está implementado.

## 1. Borrador determinista a partir de evidencias (implementado)

`services/feedback.ts` redacta un texto a partir de lo que ya está decidido: mediciones del archivo (saturación, clics, nivel, silencios, formato), etiquetas y evidencias del profesor, rúbrica y nota. El botón **Redactar borrador** del panel de revisión lo inserta en el campo de feedback para que el profesor lo edite.

- **A favor**: gratis, instantáneo, sin red, determinista (el mismo estado produce el mismo texto), nunca inventa: cada frase remite a un dato o a una anotación. Cita los tiempos de las evidencias.
- **En contra**: prosa de plantilla. No interpreta la intención artística ni matiza; sin anotaciones del profesor solo habla de lo técnico.
- **Cuándo basta**: para el 80 % de las correcciones (nivel, clips, herramientas presentes o ausentes, nota), con dos minutos de edición.

## 2. Banco de comentarios del profesor (siguiente paso recomendado)

Guardar en el navegador frases reutilizables asociadas a cada criterio («reversa sutil pero eficaz», «filtro con resonancia excesiva») y ofrecerlas al confirmar una herramienta. El borrador (opción 1) las intercala.

- **A favor**: la voz del profesor, cero coste, mejora con el uso.
- **En contra**: requiere curación inicial; sigue siendo texto fijo.
- **Esfuerzo**: bajo (localStorage + selector en `ReviewPanel`).

## 3. Modelo de lenguaje pequeño en el navegador

Cargar un LLM de 1–3 B parámetros con WebLLM (WebGPU) o Transformers.js (WASM/WebGPU) y pedirle que redacte a partir del mismo resumen estructurado que usa la opción 1. Candidatos: Qwen2.5-1.5B-Instruct, Gemma 3 1B, Llama 3.2 1B/3B, cuantizados a 4 bits (0,8–2 GB).

- **A favor**: prosa natural en castellano, privado, gratis por uso.
- **En contra**: descarga inicial de 1–2 GB por navegador, necesita WebGPU (Chrome o Edge recientes, GPU con 4 GB), 10–40 s por respuesta en portátiles, y los modelos pequeños alucinan si se les deja libertad. Habría que restringirlos a reescribir el borrador, no a evaluar.
- **Esfuerzo**: medio (dependencia `@mlc-ai/web-llm`, gestión de descarga y caché, prompt con el JSON de evidencias, verificación de que no añade datos).

## 4. Híbrido: borrador local + pulido externo opcional

El profesor genera el borrador local (opción 1 o 2) y, si tiene una clave configurada, pide «pulir la redacción» a un modelo externo enviándole solo el borrador y las evidencias. Coste típico con Gemini Flash o Claude Haiku: menos de 0,001 $ por texto.

- **A favor**: calidad de redacción alta, coste mínimo, el contenido sigue anclado a las evidencias.
- **En contra**: requiere clave; envía texto al proveedor (nunca audio).
- **Esfuerzo**: bajo (ya existe la infraestructura de proveedores en `services/llm/`).

## Recomendación

Mantener la opción 1 como base, añadir el banco de comentarios (2) y ofrecer el pulido externo (4) como botón opcional cuando haya clave. La opción 3 conviene evaluarla más adelante en equipos con WebGPU; hoy la descarga y la latencia no compensan para un texto de cuatro frases.

## Qué no debe hacer nunca el feedback automático

- Decidir etiquetas o notas: eso lo hace el profesor.
- Afirmar procesos que no estén confirmados: las sugerencias del modelo se citan como sugerencias.
- Enviar audio fuera del navegador.
