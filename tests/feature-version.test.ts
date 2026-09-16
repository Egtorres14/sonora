import { describe, expect, it } from 'vitest';
import { FEATURES_VERSION } from '../services/audio/features';
import { acceptsFeatureVersion, isCurrentFeatures, parseFeatureVersion } from '../services/audio/version';

const current = parseFeatureVersion(FEATURES_VERSION)!;
const v = (major: number, minor: number, patch: number) => `${major}.${minor}.${patch}`;

describe('Regla de versiones de características', () => {
  it('parsea una versión y rechaza lo que no lo es', () => {
    expect(parseFeatureVersion('2.1.0')).toEqual({ major: 2, minor: 1, patch: 0 });
    expect(parseFeatureVersion('2.1')).toBeNull();
    expect(parseFeatureVersion('v2.1.0')).toBeNull();
    expect(parseFeatureVersion('')).toBeNull();
    expect(parseFeatureVersion('2.x.0')).toBeNull();
  });

  it('acepta la versión actual y las menores anteriores de la misma mayor', () => {
    expect(acceptsFeatureVersion(FEATURES_VERSION)).toBe(true);
    expect(acceptsFeatureVersion(v(current.major, current.minor, current.patch + 3))).toBe(true);
    if (current.minor > 0) expect(acceptsFeatureVersion(v(current.major, current.minor - 1, 0))).toBe(true);
  });

  it('rechaza otra mayor y una menor posterior a la del código', () => {
    expect(acceptsFeatureVersion(v(current.major - 1, 9, 0))).toBe(false);
    expect(acceptsFeatureVersion(v(current.major + 1, 0, 0))).toBe(false);
    expect(acceptsFeatureVersion(v(current.major, current.minor + 1, 0))).toBe(false);
    expect(acceptsFeatureVersion('no-es-version')).toBe(false);
  });

  it('solo la versión exacta es entrenable', () => {
    expect(isCurrentFeatures({ version: FEATURES_VERSION })).toBe(true);
    expect(isCurrentFeatures({ version: v(current.major, current.minor, current.patch + 1) })).toBe(false);
    expect(isCurrentFeatures({ version: v(current.major, 0, 0) })).toBe(false);
  });
});
