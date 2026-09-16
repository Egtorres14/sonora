import { describe, expect, it } from 'vitest';
import { checkFileName, compileNamePattern, describeNamePattern } from '../services/filename-rule';
import { DEFAULT_RUBRIC, scoreFormal, type RubricConfig } from '../services/scoring/rubric';
import { fromStored, toStored } from '../services/rubric-store';

const FORMAT = '{estudiante}_{estudiante}_ejercicio{numero}';
const withFormat = (fileNamePattern: string): RubricConfig => ({ ...DEFAULT_RUBRIC, formal: { ...DEFAULT_RUBRIC.formal, fileNamePattern } });
const namePoints = (file: string, rubric: RubricConfig, student?: string) => scoreFormal(file, 'x'.repeat(200), rubric, student).lines[1];

describe('Formato de nombre exigido por el profesor', () => {
  it('acepta un nombre que sigue la plantilla', () => {
    expect(checkFileName('perez_ana_ejercicio3.wav', FORMAT, 'Ana Pérez').ok).toBe(true);
  });

  it('rechaza lo que no sigue la plantilla y dice cuál era', () => {
    const check = checkFileName('asdkjh.wav', FORMAT, 'Ana Pérez');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('no sigue el formato exigido');
    expect(check.reason).toContain(FORMAT);
  });

  it('detecta una entrega con el nombre de otra persona', () => {
    const check = checkFileName('lopez_ana_ejercicio3.wav', FORMAT, 'Ana Pérez');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('«lopez» no forma parte del nombre registrado (Ana Pérez)');
  });

  it('ignora mayúsculas y acentos en el archivo, en la plantilla y en el nombre', () => {
    expect(checkFileName('PÉREZ_Ana_EJERCICIO12.WAV', '{Estudiante}_{ESTUDIANTE}_Ejercicio{Numero}', 'ana perez').ok).toBe(true);
  });

  it('entiende cada campo', () => {
    expect(checkFileName('proyecto_7.wav', '{texto}_{numero}').ok).toBe(true);
    expect(checkFileName('proyecto_siete.wav', '{texto}_{numero}').ok).toBe(false);
    expect(checkFileName('entrega-final-v2.wav', 'entrega-*').ok).toBe(true);
    expect(checkFileName('otra-final.wav', 'entrega-*').ok).toBe(false);
  });

  it('trata como literales los caracteres especiales de la plantilla', () => {
    expect(checkFileName('ej.1 (a).wav', 'ej.{numero} (a)').ok).toBe(true);
    expect(checkFileName('ejX1 (a).wav', 'ej.{numero} (a)').ok).toBe(false);
  });

  it('admite que la plantilla incluya la extensión', () => {
    expect(checkFileName('perez_ana_ejercicio3.wav', `${FORMAT}.wav`, 'Ana Pérez').ok).toBe(true);
  });

  it('sin estudiante acepta cualquier palabra, pero sigue exigiendo la forma', () => {
    expect(checkFileName('perez_ana_ejercicio3.wav', FORMAT).ok).toBe(true);
    expect(checkFileName('perez_ejercicio3.wav', FORMAT).ok).toBe(false);
  });

  it('una plantilla vacía no compila y no exige nada', () => {
    expect(compileNamePattern('   ')).toBeNull();
  });

  it('propone un ejemplo válido con el nombre del estudiante', () => {
    expect(describeNamePattern(FORMAT, 'Ana Pérez')).toBe('ana_perez_ejercicio3.wav');
    expect(describeNamePattern(FORMAT)).toBe('apellido_nombre_ejercicio3.wav');
  });

  it('el ejemplo propuesto cumple su propia plantilla', () => {
    for (const template of [FORMAT, '{texto}_{numero}', 'entrega-*', 'ej.{numero} (a)']) {
      expect(checkFileName(describeNamePattern(template, 'Ana Pérez'), template, 'Ana Pérez').ok).toBe(true);
    }
  });
});

describe('La regla puntúa en la rúbrica', () => {
  it('con formato exigido, un nombre que no lo sigue no puntúa aunque no sea genérico', () => {
    const line = namePoints('asdkjh.wav', withFormat(FORMAT), 'Ana Pérez');
    expect(line.puntos).toBe(0);
    expect(line.detalle).toContain('no sigue el formato exigido');
  });

  it('con formato exigido, un nombre correcto puntúa entero', () => {
    expect(namePoints('perez_ana_ejercicio3.wav', withFormat(FORMAT), 'Ana Pérez').puntos).toBe(DEFAULT_RUBRIC.formal.fileNamePoints);
  });

  it('sin formato exigido se mantiene la lista de nombres genéricos', () => {
    expect(namePoints('audio1.wav', DEFAULT_RUBRIC).puntos).toBe(0);
    expect(namePoints('bosque_nocturno.wav', DEFAULT_RUBRIC).puntos).toBe(DEFAULT_RUBRIC.formal.fileNamePoints);
  });

  it('se guarda con la rúbrica y una rúbrica anterior sin el campo sigue cargando', () => {
    expect(fromStored(toStored(withFormat(FORMAT))).formal.fileNamePattern).toBe(FORMAT);
    const legacy = toStored(DEFAULT_RUBRIC) as { formal: Record<string, unknown> };
    delete legacy.formal.fileNamePattern;
    expect(fromStored(legacy).formal.fileNamePattern).toBe('');
  });
});
