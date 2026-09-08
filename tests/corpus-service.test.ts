import { describe, expect, it } from 'vitest';
import { corpusCoverage, corpusUrl, CorpusIndexSchema, describeChainStep } from '../services/corpus';

describe('Servicio del corpus publicado', () => {
  it('construye URLs respetando la base del despliegue', () => {
    expect(corpusUrl('indice.json', '/')).toBe('/corpus/indice.json');
    expect(corpusUrl('audio/x.mp3', '/sonora/')).toBe('/sonora/corpus/audio/x.mp3');
    expect(corpusUrl('modelo.json', '/sonora')).toBe('/sonora/corpus/modelo.json');
  });
  it('valida el índice y resume la cobertura por herramienta', () => {
    const index = CorpusIndexSchema.parse({
      version: 1, generatedAt: '2026-09-07T00:00:00.000Z', seed: 1, clipSeconds: 20, mp3Seconds: 12,
      sources: [{ id: 'a', category: 'voice', description: 'Voz', license: 'CC0', attribution: 'X', sourceUrl: '', sampleRate: 44100, seconds: 20 }],
      records: [
        { file: 'a__original.wav', id: '1', sourceGroup: 'a', chain: ['none'], labels: { pitch_shift: 'absent', time_stretch: 'absent', reversa: 'absent', filtros: 'absent', loops: 'absent' }, seconds: 20, audio: 'audio/a__original.mp3', variant: 'original' },
        { file: 'a__pitch_shift.wav', id: '2', sourceGroup: 'a', chain: ['pitch+7'], labels: { pitch_shift: 'present', time_stretch: 'absent', reversa: 'absent', filtros: 'absent', loops: 'absent' }, seconds: 20, variant: 'pitch_shift' },
      ],
    });
    const cov = corpusCoverage(index);
    expect(cov.find((c) => c.tool === 'pitch_shift')).toEqual({ tool: 'pitch_shift', present: 1, absent: 1 });
    expect(cov.find((c) => c.tool === 'loops')).toEqual({ tool: 'loops', present: 0, absent: 2 });
  });
  it('rechaza un índice de otra versión', () => {
    expect(() => CorpusIndexSchema.parse({ version: 2 })).toThrow();
  });
  it('describe la cadena de procesos en castellano', () => {
    expect(describeChainStep('pitch+7')).toBe('Pitch shift +7 semitonos');
    expect(describeChainStep('stretch×1.5')).toBe('Time stretch ×1.5');
    expect(describeChainStep('reverse-seg2')).toBe('Reversa por segmentos (2)');
    expect(describeChainStep('lp-sweep')).toBe('Paso bajo con barrido');
    expect(describeChainStep('loop×4')).toBe('Loop ×4');
    expect(describeChainStep('none')).toBe('Sin procesar');
  });
});
