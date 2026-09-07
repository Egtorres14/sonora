/**
 * Prompt compartido por los tres proveedores. Principios:
 *  - El modelo solo evalúa lo SUBJETIVO (creatividad, herramientas, sobreprocesamiento, coherencia).
 *  - Lo objetivo (sample rate, clipping, clics, sonoridad, duración) ya está medido y se le pasa como contexto
 *    para que lo interprete, nunca para que lo recalcule ni lo "detecte de oído".
 *  - Se le exige evidencia con marcas de tiempo y una confianza calibrada por cada afirmación.
 *  - Se le recuerda qué NO puede oír (mono, 16 kHz) para que no invente.
 */
import { serializableFeatures, formatTimestamp } from '../audio/features';
import type { EvaluationInput } from './types';

export interface PromptParts {
  system: string;
  userText: string;
}

const describeFeatures = (input: EvaluationInput): string => {
  const f = input.features;
  const clicks = f.clicks.events.slice(0, 20).map((e) => `${formatTimestamp(e.time)} (${e.kind}, conf. ${e.confidence})`).join(', ') || 'ninguno';
  const clips = f.clipping.timestamps.slice(0, 10).map(formatTimestamp).join(', ') || 'ninguna';
  const lines = [
    `- Formato: ${f.format.sampleRate} Hz, ${f.format.bitDepth || '?'} bits ${f.format.sampleFormat}, ${f.format.channels} canal(es), ${f.format.duration.toFixed(2)} s.`,
    `- Niveles: pico de muestra ${f.levels.samplePeakDbfs} dBFS, true peak ${f.levels.truePeakDbtp} dBTP, sonoridad integrada ${f.levels.integratedLufs} LUFS, LRA ${f.levels.loudnessRangeLu} LU, factor de cresta ${f.levels.crestFactorDb} dB.`,
    `- Clipping: ${f.clipping.detected ? `SÍ (${f.clipping.runCount} rachas; inicio en ${clips})` : 'no'}. Picos inter-muestra > −1 dBTP: ${f.clipping.interSampleOvers ? 'sí' : 'no'}.`,
    `- Clics/discontinuidades medidos: ${f.clicks.count + f.clicks.discontinuities} → ${clicks}.`,
    `- Silencio: inicial ${f.silence.leadingSec} s, final ${f.silence.trailingSec} s, huecos internos ≥100 ms: ${f.silence.gaps.length}.`,
    f.stereo ? `- Estéreo: correlación L/R ${f.stereo.correlation}, balance ${f.stereo.balanceDb} dB, lado/medio ${f.stereo.sideToMidDb} dB${f.stereo.isDualMono ? ' (dual mono: L = R)' : ''}.` : '- Archivo mono.',
    `- Espectro: centroide ${f.spectrum.centroidHz} Hz, roll-off 95 % ${f.spectrum.rolloff95Hz} Hz, ancho de banda útil ${f.spectrum.bandwidthHz} Hz, energía > 16 kHz ${f.spectrum.energyAbove16kDb} dB, planitud ${f.spectrum.flatness}.`,
    `- Heurístico de envolventes "en reversa" (crescendo largo + corte seco): ${f.heuristics.reverseEnvelopeEvents} evento(s)${f.heuristics.reverseEnvelopeTimes.length ? ` en ${f.heuristics.reverseEnvelopeTimes.map(formatTimestamp).join(', ')}` : ''}. Es solo una pista, no una prueba.`,
    `- Temporal: ${f.temporal.onsetRate} ataques/s; asimetría de envolvente ${f.temporal.envelopeAsymmetry} (natural > 0, reversa < 0; ${Math.round(f.temporal.reverseLikeFraction * 100)} % de picos "en reversa"); periodicidad ${f.temporal.periodicityStrength} a ${f.temporal.periodicityLagSec} s; repeticiones digitales idénticas: ${Math.round(f.temporal.repeatFraction * 100)} % de bloques a ${f.temporal.repeatLagSec} s (alto = loop copiado o tono perfectamente periódico); cresta del flujo espectral ${f.temporal.fluxCrest} (baja = transitorios emborronados).`,
    `- DC offset: ${f.levels.dcOffset.join(' / ')}${f.levels.dcOffsetWarning ? ' (ATENCIÓN: desplazamiento apreciable)' : ''}.`,
  ];
  return lines.join('\n');
};

export const buildPrompt = (input: EvaluationInput, capabilities: { audio: boolean; image: boolean }): PromptParts => {
  const r = input.rubric;
  const tools = r.creative.requiredTools.map((t) => t.replace('_', ' ')).join(', ');

  const perception = capabilities.audio
    ? `Recibes el AUDIO (mezclado a mono y remuestreado a 16 kHz: NO puedes oír nada por encima de 8 kHz ni juzgar la imagen estéreo)${capabilities.image ? ', un ESPECTROGRAMA de banda completa del archivo original' : ''} y un INFORME DE MÉTRICAS medidas con precisión sobre el archivo original.`
    : `NO recibes el audio. Recibes un ESPECTROGRAMA (eje X tiempo, eje Y frecuencia logarítmica 20 Hz–${Math.round(input.features.format.sampleRate / 2 / 1000)} kHz, color = nivel en dB) y un INFORME DE MÉTRICAS medidas con precisión. Razona sobre patrones visibles: bandas armónicas desplazadas (pitch shift), transitorios emborronados o "peine" (time stretch), colas que crecen y cortan en seco (reversa), recortes espectrales netos (filtros), repeticiones periódicas idénticas (loops), rejilla de aliasing por encima de la fundamental.`;

  const system = `Eres un profesor experto en producción de audio que evalúa proyectos de estudiantes. Tu criterio es riguroso, constructivo y honesto sobre tus propios límites.

${perception}

REGLAS
1. No recalcules ni "detectes de oído" nada que ya esté medido (sample rate, clipping, clics, sonoridad, duración, DC). Esos datos son ciertos: interprétalos y úsalos para contextualizar, no los contradigas.
2. Tu trabajo es la parte SUBJETIVA: qué herramientas creativas se usaron (${tools}, loops), con qué calidad, si hay sobreprocesamiento, si hay efectos extra (generador de tonos, delay, reverb, modulación) y si el resultado es coherente con la sinopsis y el objetivo del ejercicio.
3. Por cada afirmación da EVIDENCIA con marca de tiempo (m:ss) y una CONFIANZA calibrada de 0 a 1. Si no hay evidencia, di "no detectado" con la confianza que tengas en esa ausencia. Una confianza de 0.5 significa "no puedo saberlo". No infles la confianza para parecer útil.
4. Distingue "no lo oigo" de "no está": los efectos sutiles, la anchura estéreo y todo lo que ocurra por encima de 8 kHz pueden ser inaudibles para ti. Decláralo en "limitaciones".
5. No calcules puntuaciones ni sumas: eso lo hace la aplicación con tus detecciones. No menciones puntos.
6. Escribe en español, dirigiéndote al estudiante en los comentarios generales (segunda persona), con tono profesional y concreto.
7. Responde ÚNICAMENTE con el JSON del esquema indicado.`;

  const userText = `ARCHIVO: "${input.fileName}"

SINOPSIS DEL ESTUDIANTE:
${input.synopsis.trim() || '(no se proporcionó sinopsis)'}

CONTEXTO / OBJETIVO DEL EJERCICIO:
${input.context.trim() || '(no se proporcionó contexto)'}

INFORME DE MÉTRICAS (medidas en el archivo original, fiables):
${describeFeatures(input)}

Espectro promedio (48 bandas log, dB relativos al máximo): ${input.features.spectrum.ltas.map((b) => `${b.hz}:${b.db}`).join(' ')}

Métricas completas en JSON:
${JSON.stringify(serializableFeatures({ ...input.features, clicks: { ...input.features.clicks, events: input.features.clicks.events.slice(0, 30) } }))}

Evalúa ahora la parte subjetiva siguiendo las reglas y devuelve el JSON.`;

  return { system, userText };
};
