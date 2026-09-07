/**
 * Decodificador PCM nativo para WAV (RIFF) y AIFF/AIFC.
 *
 * ¿Por qué no usar `AudioContext.decodeAudioData`?
 *  - Remuestrea al sample rate del dispositivo (44.1 k o 48 k), así que perdemos
 *    la frecuencia de muestreo real del archivo y los timestamps se desplazan.
 *  - Convierte a float32 y pierde la información de profundidad de bits, por lo
 *    que no podemos detectar clipping a escala completa de enteros.
 *  - No está disponible dentro de un Web Worker.
 *
 * Este módulo lee el contenedor directamente, devuelve las muestras en el
 * dominio original (sin remuestreo) y conserva bitDepth y formato de muestra.
 */

export type SampleFormat = 'int' | 'float' | 'unknown';
export type Container = 'wav' | 'aiff' | 'other';

export interface DecodedAudio {
  sampleRate: number;
  bitDepth: number; // 0 si se desconoce
  sampleFormat: SampleFormat;
  channels: Float32Array[]; // rango nominal -1..1
  length: number; // muestras por canal
  duration: number; // segundos
  container: Container;
  decoder: 'native-pcm' | 'webaudio';
  /** Etiqueta de formato WAV (1 = PCM, 3 = IEEE float, 0xFFFE = EXTENSIBLE) o tipo de compresión AIFC */
  formatTag?: number | string;
}

export interface AudioHeaderInfo {
  container: Container;
  sampleRate: number;
  bitDepth: number;
  numChannels: number;
  sampleFormat: SampleFormat;
  formatTag?: number | string;
  dataOffset?: number;
  dataLength?: number;
  numFrames?: number;
}

const readFourCC = (view: DataView, offset: number): string =>
  String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

/** Lee un float de 80 bits (IEEE 754 extended) como usa AIFF para el sample rate. */
const readExtended80 = (view: DataView, offset: number): number => {
  const expon = view.getUint16(offset, false);
  const hiMant = view.getUint32(offset + 2, false);
  const loMant = view.getUint32(offset + 6, false);
  const sign = expon & 0x8000 ? -1 : 1;
  const exp = expon & 0x7fff;
  if (exp === 0 && hiMant === 0 && loMant === 0) return 0;
  const mantissa = hiMant * 2 ** 32 + loMant;
  return sign * mantissa * 2 ** (exp - 16383 - 63);
};

/**
 * Analiza únicamente la cabecera (sin decodificar muestras).
 * Funciona con un `ArrayBuffer` parcial siempre que contenga los chunks `fmt `/`COMM`.
 */
export const parseAudioHeader = (buffer: ArrayBuffer): AudioHeaderInfo | null => {
  if (buffer.byteLength < 12) return null;
  const view = new DataView(buffer);
  const magic = readFourCC(view, 0);

  // RFC 9639 §8.2: STREAMINFO is always the first FLAC metadata block.
  if (magic === 'fLaC') {
    if (view.byteLength < 42 || (view.getUint8(4) & 0x7f) !== 0 || view.getUint32(4, false) % 0x1000000 !== 34) return null;
    const packed = view.getBigUint64(18, false);
    const sampleRate = Number(packed >> 44n);
    const numChannels = Number((packed >> 41n) & 7n) + 1;
    const bitDepth = Number((packed >> 36n) & 31n) + 1;
    if (!sampleRate || bitDepth < 4) return null;
    return { container: 'other', formatTag: 'FLAC', sampleRate, numChannels, bitDepth, sampleFormat: 'int', numFrames: Number(packed & 0xfffffffffn) };
  }

  if (magic === 'RIFF' || magic === 'RF64') {
    if (readFourCC(view, 8) !== 'WAVE') return null;
    let offset = 12;
    let info: Partial<AudioHeaderInfo> = { container: 'wav' };
    let ds64DataSize: number | undefined;
    while (offset + 8 <= view.byteLength) {
      const id = readFourCC(view, offset);
      let size = view.getUint32(offset + 4, true);
      const body = offset + 8;
      if (id === 'ds64' && body + 16 <= view.byteLength) {
        // RF64: tamaños de 64 bits (usamos los 32 bits bajos + altos)
        const dataLo = view.getUint32(body + 8, true);
        const dataHi = view.getUint32(body + 12, true);
        ds64DataSize = dataHi * 2 ** 32 + dataLo;
      }
      if (id === 'fmt ' && body + 16 <= view.byteLength) {
        let formatTag: number = view.getUint16(body, true);
        const numChannels = view.getUint16(body + 2, true);
        const sampleRate = view.getUint32(body + 4, true);
        const bitDepth = view.getUint16(body + 14, true);
        if (formatTag === 0xfffe && body + 26 <= view.byteLength) {
          // WAVE_FORMAT_EXTENSIBLE: el subformato real está en los 2 primeros bytes del GUID
          formatTag = view.getUint16(body + 24, true);
        }
        const sampleFormat: SampleFormat = formatTag === 3 ? 'float' : formatTag === 1 ? 'int' : 'unknown';
        info = { ...info, formatTag, numChannels, sampleRate, bitDepth, sampleFormat };
      }
      if (id === 'data') {
        if (size === 0xffffffff && ds64DataSize !== undefined) size = ds64DataSize;
        info.dataOffset = body;
        info.dataLength = Math.min(size, view.byteLength - body);
        break; // el chunk data suele ser el último y puede ser enorme: no seguimos
      }
      offset = body + size + (size % 2);
    }
    if (!info.sampleRate) return null;
    if (info.dataLength !== undefined && info.numChannels && info.bitDepth) {
      info.numFrames = Math.floor(info.dataLength / (info.numChannels * (info.bitDepth / 8)));
    }
    return info as AudioHeaderInfo;
  }

  if (magic === 'FORM') {
    const type = readFourCC(view, 8);
    if (type !== 'AIFF' && type !== 'AIFC') return null;
    let offset = 12;
    let info: Partial<AudioHeaderInfo> = { container: 'aiff', sampleFormat: 'int', formatTag: 'NONE' };
    while (offset + 8 <= view.byteLength) {
      const id = readFourCC(view, offset);
      const size = view.getUint32(offset + 4, false);
      const body = offset + 8;
      if (id === 'COMM' && body + 18 <= view.byteLength) {
        info.numChannels = view.getUint16(body, false);
        info.numFrames = view.getUint32(body + 2, false);
        info.bitDepth = view.getUint16(body + 6, false);
        info.sampleRate = Math.round(readExtended80(view, body + 8));
        if (type === 'AIFC' && body + 22 <= view.byteLength) {
          const comp = readFourCC(view, body + 18);
          info.formatTag = comp;
          if (comp === 'fl32' || comp === 'FL32' || comp === 'fl64' || comp === 'FL64') info.sampleFormat = 'float';
          else if (comp === 'NONE' || comp === 'sowt' || comp === 'twos') info.sampleFormat = 'int';
          else info.sampleFormat = 'unknown';
        }
      }
      if (id === 'SSND' && body + 8 <= view.byteLength) {
        const ssndOffset = view.getUint32(body, false);
        info.dataOffset = body + 8 + ssndOffset;
        info.dataLength = Math.min(size - 8 - ssndOffset, view.byteLength - info.dataOffset);
        break;
      }
      offset = body + size + (size % 2);
    }
    if (!info.sampleRate) return null;
    return info as AudioHeaderInfo;
  }

  return null;
};

/**
 * Decodifica WAV/AIFF PCM (8/16/24/32 bits enteros, 32/64 bits float) sin remuestrear.
 * Devuelve `null` si el formato no es PCM soportado (p. ej. MP3 dentro de WAV, µ-law, IMA ADPCM).
 */
export const decodePcm = (buffer: ArrayBuffer): DecodedAudio | null => {
  const info = parseAudioHeader(buffer);
  if (!info || info.dataOffset === undefined || info.dataLength === undefined || !info.numChannels || !info.bitDepth) return null;
  const { numChannels, bitDepth, sampleRate, container } = info;
  const bytesPerSample = bitDepth / 8;
  if (![1, 2, 3, 4, 8].includes(bytesPerSample)) return null;

  // Endianness: WAV = little-endian; AIFF = big-endian salvo AIFC 'sowt'
  const little = container === 'wav' || info.formatTag === 'sowt';
  const isFloat = info.sampleFormat === 'float';
  if (info.sampleFormat === 'unknown') return null;
  if (isFloat && bytesPerSample !== 4 && bytesPerSample !== 8) return null;
  if (!isFloat && bytesPerSample === 8) return null;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || numChannels > 32) throw new Error('Cabecera PCM inválida.');

  const frameSize = numChannels * bytesPerSample;
  const numFrames = Math.floor(info.dataLength / frameSize);
  if (numFrames < 1) throw new Error('El archivo PCM no contiene muestras completas.');
  const view = new DataView(buffer, info.dataOffset, numFrames * frameSize);
  const channels = Array.from({ length: numChannels }, () => new Float32Array(numFrames));

  // Escalas: los enteros se normalizan por 2^(bits-1) para que el fondo de escala negativo sea exactamente -1.
  const scale = 1 / 2 ** (bitDepth - 1);
  const unsigned8 = container === 'wav' && bytesPerSample === 1; // WAV de 8 bits es sin signo

  for (let f = 0; f < numFrames; f++) {
    for (let c = 0; c < numChannels; c++) {
      const p = (f * numChannels + c) * bytesPerSample;
      let v: number;
      if (isFloat) {
        v = bytesPerSample === 4 ? view.getFloat32(p, little) : view.getFloat64(p, little);
      } else if (bytesPerSample === 1) {
        v = (unsigned8 ? view.getUint8(p) - 128 : view.getInt8(p)) * scale;
      } else if (bytesPerSample === 2) {
        v = view.getInt16(p, little) * scale;
      } else if (bytesPerSample === 3) {
        const b0 = view.getUint8(p), b1 = view.getUint8(p + 1), b2 = view.getUint8(p + 2);
        let raw = little ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2;
        if (raw & 0x800000) raw -= 0x1000000; // signo en 24 bits
        v = raw * scale;
      } else {
        v = view.getInt32(p, little) * scale;
      }
      if (!Number.isFinite(v) || Math.abs(v) > 3.4028234663852886e38) throw new Error('El audio contiene una muestra no finita o fuera del rango admitido.');
      channels[c][f] = v;
    }
  }

  return {
    sampleRate,
    bitDepth,
    sampleFormat: isFloat ? 'float' : 'int',
    channels,
    length: numFrames,
    duration: numFrames / sampleRate,
    container,
    decoder: 'native-pcm',
    formatTag: info.formatTag,
  };
};

/** Codifica PCM sin remuestreo; float32 conserva la señal de reproducción AIFF. */
const encodeWav = (channels: Float32Array[], sampleRate: number, float: boolean): ArrayBuffer => {
  const numChannels = channels.length;
  const numFrames = channels[0]?.length ?? 0;
  const bytes = float ? 4 : 2;
  const dataSize = numFrames * numChannels * bytes;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, float ? 3 : 1, true);
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytes, true); view.setUint16(32, numChannels * bytes, true); view.setUint16(34, bytes * 8, true);
  writeStr(36, 'data'); view.setUint32(40, dataSize, true);
  let p = 44;
  for (let f = 0; f < numFrames; f++) {
    for (let c = 0; c < numChannels; c++) {
      if (float) view.setFloat32(p, channels[c][f], true);
      else {
        const s = Math.max(-1, Math.min(1, channels[c][f]));
        view.setInt16(p, s < 0 ? s * 32768 : s * 32767, true);
      }
      p += bytes;
    }
  }
  return buffer;
};
export const encodeWav16 = (channels: Float32Array[], sampleRate: number) => encodeWav(channels, sampleRate, false);
export const encodeWavFloat32 = (channels: Float32Array[], sampleRate: number) => encodeWav(channels, sampleRate, true);
