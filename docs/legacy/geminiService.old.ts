import { GoogleGenAI, Type } from "@google/genai";
import { AudioEvaluation, TechnicalReport } from '../types';

const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string; } }> => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result.split(',')[1]);
      } else {
        resolve('');
      }
    };
    reader.readAsDataURL(file);
  });
  const data = await base64EncodedDataPromise;
  return {
    inlineData: {
      mimeType: file.type,
      data,
    },
  };
};

const getEvaluationSchema = () => ({
    type: Type.OBJECT,
    properties: {
        nombre_archivo: { type: Type.STRING, description: "El nombre del archivo de audio evaluado." },
        evaluacion_rubrica: {
            type: Type.OBJECT,
            properties: {
                presencia_sinopsis: {
                    type: Type.OBJECT,
                    properties: {
                        puntos_obtenidos: { type: Type.NUMBER },
                        puntos_posibles: { type: Type.NUMBER },
                        comentarios: { type: Type.STRING }
                    },
                    required: ['puntos_obtenidos', 'puntos_posibles', 'comentarios']
                },
                nombre_y_sinopsis: {
                    type: Type.OBJECT,
                    properties: {
                        puntos_obtenidos: { type: Type.NUMBER },
                        puntos_posibles: { type: Type.NUMBER },
                        comentarios: { type: Type.STRING }
                    },
                    required: ['puntos_obtenidos', 'puntos_posibles', 'comentarios']
                }
            },
            required: ['presencia_sinopsis', 'nombre_y_sinopsis']
        },
        evaluacion_tecnica: {
            type: Type.OBJECT,
            properties: {
                presencia_de_artefactos: {
                    type: Type.OBJECT,
                    properties: {
                        clics_y_pops: {
                            type: Type.OBJECT,
                            properties: {
                                detectado: { type: Type.BOOLEAN },
                                cantidad_aproximada: { type: Type.NUMBER },
                                comentarios: { type: Type.STRING }
                            },
                            required: ['detectado', 'cantidad_aproximada', 'comentarios']
                        },
                        distorsion_digital: {
                            type: Type.OBJECT,
                            properties: {
                                detectado: { type: Type.BOOLEAN },
                                comentarios: { type: Type.STRING }
                            },
                            required: ['detectado', 'comentarios']
                        },
                        otros_problemas: { type: Type.STRING }
                    },
                    required: ['clics_y_pops', 'distorsion_digital', 'otros_problemas']
                },
                duracion_audio: {
                    type: Type.OBJECT,
                    properties: {
                        segundos: { type: Type.NUMBER },
                        comentarios: { type: Type.STRING }
                    },
                    required: ['segundos', 'comentarios']
                },
                calificacion_tecnica: { type: Type.NUMBER, description: "Calificación de 0 a 12.5." },
                sample_rate: { type: Type.NUMBER, description: "La frecuencia de muestreo del archivo de audio en Hz. Extraído de los metadatos del archivo." },
                bit_depth: { type: Type.NUMBER, description: "La profundidad de bits del archivo de audio. Extraído de los metadatos del archivo." }
            },
            required: ['presencia_de_artefactos', 'duracion_audio', 'calificacion_tecnica', 'sample_rate', 'bit_depth']
        },
        evaluacion_creatividad_y_procesamiento: {
            type: Type.OBJECT,
            properties: {
                herramientas_utilizadas: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            herramienta: { type: Type.STRING, enum: ["pitch_shift", "reversa", "time_stretch", "loops", "filtros"] },
                            detectado: { type: Type.BOOLEAN },
                            calidad_de_uso: { type: Type.STRING, enum: ["Buena", "Regular", "Mala", "N/A"] },
                            comentarios: { type: Type.STRING }
                        },
                        required: ['herramienta', 'detectado', 'calidad_de_uso', 'comentarios']
                    }
                },
                sobreprocesamiento: {
                    type: Type.OBJECT,
                    properties: {
                        detectado: { type: Type.BOOLEAN },
                        nivel: { type: Type.STRING, enum: ["Leve", "Moderado", "Severo", "N/A"] },
                        comentarios: { type: Type.STRING }
                    },
                    required: ['detectado', 'nivel', 'comentarios']
                },
                calificacion_creatividad: { type: Type.NUMBER, description: "Calificación de 0 a 12.5." }
            },
            required: ['herramientas_utilizadas', 'sobreprocesamiento', 'calificacion_creatividad']
        },
        puntos_extra: {
            type: Type.OBJECT,
            properties: {
                detectado: { type: Type.BOOLEAN },
                comentarios: { type: Type.STRING },
                puntos: { type: Type.NUMBER, description: "Puntos extra otorgados. Debe ser 0 o 0.5." }
            },
            required: ['detectado', 'comentarios', 'puntos']
        },
        resumen_y_calificacion_final: {
            type: Type.OBJECT,
            properties: {
                comentarios_generales: { type: Type.STRING },
                calificacion_final: { type: Type.NUMBER, description: "Suma de todas las calificaciones, sobre 30." }
            },
            required: ['comentarios_generales', 'calificacion_final']
        }
    },
    required: ['nombre_archivo', 'evaluacion_rubrica', 'evaluacion_tecnica', 'evaluacion_creatividad_y_procesamiento', 'puntos_extra', 'resumen_y_calificacion_final']
});


export const analyzeAudio = async (file: File, synopsis: string, context: string, technicalReport: TechnicalReport): Promise<AudioEvaluation> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const audioPart = await fileToGenerativePart(file);
  const technicalReportJsonString = JSON.stringify(technicalReport, null, 2);

  const systemInstruction = `
    Eres un "Profesor Experto en Producción de Audio", una IA diseñada para evaluar proyectos de audio de estudiantes. Tu evaluación debe ser constructiva, educativa y rigurosa.

    Hoy vas a evaluar un proyecto. Te proporcionaré el archivo de audio, la sinopsis del estudiante, los requisitos del ejercicio y, lo más importante, un **INFORME TÉCNICO** pre-generado por un analizador de audio.

    **Tus reglas son las siguientes:**
    1.  **NO intentes detectar problemas técnicos por tu cuenta.** Toda tu retroalimentación sobre calidad técnica (clipping, clics, sonoridad, sample rate) DEBE BASARSE EXCLUSIVAMENTE en los datos del \`technicalReport\` que te proporciono. Tu rol es interpretar estos datos para el estudiante.
    2.  **Interpreta los datos, no solo los repitas.** Si el informe dice \`"isClipping": true\`, explícale al estudiante qué significa ("distorsión digital"). Si dice \`"sampleRate": 44100\`, explícale por qué no cumple el requisito de 48000 Hz.
    3.  **Utiliza los timestamps.** Si el informe lista clics, tu comentario sobre clics DEBE ser una lista de los timestamps exactos del informe para que el estudiante pueda encontrarlos. Si no hay clics, el comentario debe ser "No se detectaron clics o pops de edición.".
    4.  **Evalúa la creatividad y el procesamiento.** Esta es tu área subjetiva. Escucha el audio y analiza el uso de efectos (reverb, delay, pitch shift) y cómo se alinea con la sinopsis del estudiante.
    5.  **Responde SIEMPRE usando el siguiente esquema JSON (\`responseSchema\`).** No añadas explicaciones fuera de la estructura JSON.
    6.  **Para la evaluación técnica (calificacion_tecnica), sigue estas reglas de puntuación estrictamente:**
        *   **Punto de Partida: 12.5 puntos.**
        *   **Frecuencia de Muestreo:** Si \`technicalReport.metadata.sampleRate\` no es 48000, deduce 2.5 puntos.
        *   **Clipping/Distorsión:** Si \`technicalReport.levels.isClipping\` es true, deduce 2.5 puntos.
        *   **Clics y Pops:** Deduce puntos según la cantidad de clics: 1-2 clics = -1.0 pt; 3-5 clics = -2.5 pts; >5 clics = -4.0 pts.
        *   **Duración:** Deduce 1.0 punto si la duración (\`technicalReport.metadata.duration\`) está fuera del rango de 55 a 65 segundos.
    7.  Rellena 'sample_rate' y 'bit_depth' con los valores del informe técnico. La 'cantidad_aproximada' de clics debe ser el número de timestamps en el informe.

    **INFORME TÉCNICO (DATOS OBJETIVOS):**
    \`\`\`json
    ${technicalReportJsonString}
    \`\`\`

    **CONTEXTO DEL ESTUDIANTE:**
    - Sinopsis: "${synopsis || 'No se proporcionó sinopsis.'}"
    - Contexto del Ejercicio: "${context || 'No se proporcionó contexto.'}"
    - Nombre del Archivo: "${file.name}"

    **Rúbrica (5 puntos):**
    - **Presencia de Sinopsis (2.5 pts):** Otorga 2.5 si la sinopsis no está vacía, 0 si lo está.
    - **Nombre del Archivo (2.5 pts):** Otorga 2.5 si el nombre ("${file.name}") no es genérico (e.g., 'audio.wav', 'proyecto1.wav'). Otorga 0 si lo es.
    
    **Creatividad (12.5 puntos):**
    *   **Punto de Partida: 12.5 puntos.**
    *   **Uso de Herramientas Obligatorias:** El estudiante DEBE usar 'pitch shift', 'time stretch', 'reversa' y 'filtros'. Por CADA una de estas cuatro herramientas NO utilizada, deduce 2.5 puntos.
    *   **Calidad del Procesamiento:** Evalúa la calidad de la aplicación de las herramientas. Busca artefactos como 'aliasing' o sonido metálico por abuso de pitch/time stretch. Si la calidad es mala ('Regular' o 'Mala'), indica 'sobreprocesamiento' y deduce de 1.0 a 2.5 puntos adicionales, dependiendo de la severidad.

    **Puntos Extra (Bonus +0.5):**
    *   Si detectas el uso claro de 'generador de tonos', 'delays', 'reverberaciones' o 'efectos de modulación' (chorus, flanger, phaser), otorga 0.5 puntos extra en TOTAL (no por cada uno).

    **Calificación Final (sobre 30):**
    *   Calcula la 'calificacion_final' sumando: (puntos de rúbrica) + (calificacion_tecnica) + (calificacion_creatividad) + (puntos_extra.puntos).
    *   Escribe 'comentarios_generales' constructivos, resumiendo los puntos fuertes y las áreas de mejora.

    Ahora, analiza el audio y el contexto, y completa la evaluación.
    `;

  let response;
  try {
    response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
          parts: [
              {text: systemInstruction},
              audioPart
          ]
      },
      config: {
          responseMimeType: 'application/json',
          responseSchema: getEvaluationSchema()
      },
    });
  } catch (error: any) {
    console.error("Error from Gemini API:", error);
    let message = "Ocurrió un error desconocido al contactar a la IA.";

    if (error.message) {
        if (error.message.includes('API key not valid')) {
            message = "La clave de API proporcionada no es válida. Por favor, verifica que esté configurada correctamente.";
        } else if (error.message.toLowerCase().includes('quota')) {
            message = "Se ha excedido la cuota de uso de la API. Inténtalo de nuevo más tarde o revisa tu plan.";
        } else if (error.message.includes('400')) {
             message = "Solicitud incorrecta. El modelo de IA no pudo procesar el archivo. Puede que esté corrupto o en un formato no compatible.";
        } else if (error.message.includes('500') || error.message.includes('503')) {
            message = "El servicio de IA no está disponible en este momento. Por favor, inténtalo de nuevo más tarde.";
        } else if (error.message.includes('safety')) {
            message = "El contenido fue bloqueado por políticas de seguridad. No se pudo completar la evaluación.";
        } else {
             message = "Error en la comunicación con la IA. No se pudo completar la solicitud.";
        }
    }
    throw new Error(message);
  }
    
  try {
    const jsonText = response.text.trim();
    if (!jsonText) {
        throw new Error("La IA devolvió una respuesta vacía. No se pudo generar la evaluación.");
    }
    const evaluationResult: AudioEvaluation = JSON.parse(jsonText);
    return evaluationResult;
  } catch (parseError) {
      console.error("Error parsing JSON from Gemini:", parseError);
      console.error("Received text:", response?.text);
      throw new Error("La IA devolvió una respuesta con un formato inválido. No se pudo procesar la evaluación.");
  }
};