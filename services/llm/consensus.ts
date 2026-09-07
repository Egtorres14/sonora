/**
 * Consenso entre varias ejecuciones del mismo modelo (o de distintos modelos).
 * Reduce la varianza de una única llamada: booleanos por mayoría, números por media,
 * enumerados por moda, textos del run "más representativo". Devuelve además el grado
 * de acuerdo, que la UI muestra como fiabilidad.
 */
import { TOOL_IDS, type CreativeAssessment, type ToolAssessment } from './schema';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const majority = (xs: boolean[]) => xs.filter(Boolean).length * 2 > xs.length;
const mode = <T extends string>(xs: T[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const agreementOf = (xs: boolean[]) => (xs.length ? Math.max(xs.filter(Boolean).length, xs.filter((x) => !x).length) / xs.length : 1);

export interface ConsensusResult {
  assessment: CreativeAssessment;
  /** 0..1: proporción media de runs que coinciden en cada decisión binaria */
  agreement: number | null;
  /** Decisiones en las que NO hubo unanimidad, para que el profesor las revise */
  disputed: string[];
  runs: number;
}

export const aggregateAssessments = (runs: CreativeAssessment[]): ConsensusResult => {
  if (runs.length === 0) throw new Error('No hay evaluaciones que agregar.');
  if (runs.length === 1) return { assessment: runs[0], agreement: null, disputed: [], runs: 1 };

  const agreements: number[] = [];
  const disputed: string[] = [];
  const note = (label: string, xs: boolean[]) => { const a = agreementOf(xs); agreements.push(a); if (a < 1) disputed.push(label); };

  const herramientas: ToolAssessment[] = TOOL_IDS.map((id) => {
    const items = runs.map((r) => r.herramientas.find((h) => h.herramienta === id)).filter((h): h is ToolAssessment => !!h);
    const dets = items.map((h) => h.detectado);
    const detectado = majority(dets);
    note(`herramienta ${id}`, dets);
    const agreeing = items.filter((h) => h.detectado === detectado);
    // La confianza agregada pondera por el acuerdo: si la mitad dice que no, la confianza baja.
    const confianza = +(mean(agreeing.map((h) => h.confianza)) * agreementOf(dets)).toFixed(2);
    const best = agreeing.sort((a, b) => b.confianza - a.confianza)[0];
    return {
      herramienta: id,
      detectado,
      confianza,
      evidencia: best?.evidencia ?? '',
      calidad_de_uso: detectado ? mode(agreeing.map((h) => h.calidad_de_uso).filter((q) => q !== 'N/A')) ?? 'N/A' : 'N/A',
    };
  });

  const opDets = runs.map((r) => r.sobreprocesamiento.detectado);
  const opDet = majority(opDets);
  note('sobreprocesamiento', opDets);
  const opAgree = runs.filter((r) => r.sobreprocesamiento.detectado === opDet);
  const sobreprocesamiento: CreativeAssessment['sobreprocesamiento'] = {
    detectado: opDet,
    nivel: opDet ? mode(opAgree.map((r) => r.sobreprocesamiento.nivel).filter((n) => n !== 'N/A')) ?? 'N/A' : 'N/A',
    confianza: +(mean(opAgree.map((r) => r.sobreprocesamiento.confianza)) * agreementOf(opDets)).toFixed(2),
    comentarios: opAgree.sort((a, b) => b.sobreprocesamiento.confianza - a.sobreprocesamiento.confianza)[0].sobreprocesamiento.comentarios,
  };

  const exDets = runs.map((r) => r.efectos_extra.detectado);
  const exDet = majority(exDets);
  note('efectos extra', exDets);
  const exAgree = runs.filter((r) => r.efectos_extra.detectado === exDet);
  const efectos_extra: CreativeAssessment['efectos_extra'] = {
    detectado: exDet,
    cuales: [...new Set(exAgree.flatMap((r) => r.efectos_extra.cuales))],
    confianza: +(mean(exAgree.map((r) => r.efectos_extra.confianza)) * agreementOf(exDets)).toFixed(2),
    comentarios: exAgree.sort((a, b) => b.efectos_extra.confianza - a.efectos_extra.confianza)[0].efectos_extra.comentarios,
  };

  // Run representativo para los textos: el que más se acerca a las decisiones mayoritarias
  const score = (r: CreativeAssessment) =>
    herramientas.reduce((s, h) => s + (r.herramientas.find((x) => x.herramienta === h.herramienta)?.detectado === h.detectado ? 1 : 0), 0) +
    (r.sobreprocesamiento.detectado === opDet ? 1 : 0) + (r.efectos_extra.detectado === exDet ? 1 : 0);
  const rep = [...runs].sort((a, b) => score(b) - score(a))[0];

  const assessment: CreativeAssessment = {
    descripcion_sonora: rep.descripcion_sonora,
    herramientas,
    sobreprocesamiento,
    efectos_extra,
    coherencia_con_sinopsis: {
      puntuacion: +mean(runs.map((r) => r.coherencia_con_sinopsis.puntuacion)).toFixed(2),
      comentarios: rep.coherencia_con_sinopsis.comentarios,
    },
    fortalezas: rep.fortalezas,
    mejoras: rep.mejoras,
    comentarios_generales: rep.comentarios_generales,
    limitaciones: rep.limitaciones,
  };

  return { assessment, agreement: +mean(agreements).toFixed(2), disputed, runs: runs.length };
};
