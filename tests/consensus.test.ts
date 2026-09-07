import { describe, expect, it } from 'vitest';
import { aggregateAssessments } from '../services/llm/consensus';
import { normalizeAssessment } from '../services/llm/schema';

const assessment = () => normalizeAssessment({
  descripcion_sonora: 'Prueba',
  herramientas: [{ herramienta: 'pitch_shift', detectado: true, confianza: 0.8, evidencia: '0:01', calidad_de_uso: 'N/A' }],
  sobreprocesamiento: { detectado: true, nivel: 'N/A', confianza: 0.8, comentarios: 'Indeterminado' },
  efectos_extra: { detectado: false, cuales: [], confianza: 0.8, comentarios: '' },
  coherencia_con_sinopsis: { puntuacion: 3, comentarios: '' },
  fortalezas: [], mejoras: [], comentarios_generales: '', limitaciones: '',
});

describe('Consenso con datos incompletos del modelo', () => {
  it('acepta N/A sin intentar indexar una moda vacía', () => {
    const result = aggregateAssessments([assessment(), assessment(), assessment()]);
    expect(result.assessment.herramientas[0].calidad_de_uso).toBe('N/A');
    expect(result.assessment.sobreprocesamiento.nivel).toBe('N/A');
  });
  it('una sola ejecución no mide acuerdo entre ejecuciones', () => {
    expect(aggregateAssessments([assessment()]).agreement).toBeNull();
  });
});
