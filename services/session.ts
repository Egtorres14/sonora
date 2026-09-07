/**
 * Sesión de acceso: profesor (con PIN) o estudiante (con nombre).
 *
 * Es una separación de espacios dentro de un mismo navegador, útil en un aula o en un equipo
 * compartido. NO es seguridad: todo vive en el almacenamiento local del navegador y no hay
 * servidor. El PIN evita que un estudiante entre por error en la vista del profesor, nada más.
 */
export type Role = 'teacher' | 'student';
export interface Session { role: Role; studentName?: string; enteredAt: string }

const SESSION_KEY = 'sonora.session.v1';
const PIN_KEY = 'sonora.teacher-pin.v1';
/** PIN del profesor acordado para este despliegue (guardado como SHA-256, no en claro). Un PIN propio guardado en el navegador lo sustituye. */
const DEFAULT_PIN_HASH = '74688ed9a432b7dd10bbc5cba8b55a97b1a597ec262b79350dc040a0b98bec28';
const memory = new Map<string, string>();

const store = {
  get(key: string): string | null { try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : memory.get(key) ?? null; } catch { return memory.get(key) ?? null; } },
  set(key: string, value: string) { try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); else memory.set(key, value); } catch { memory.set(key, value); } },
  remove(key: string) { try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch { /* sin almacenamiento */ } memory.delete(key); },
};

const sha256 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Normaliza un nombre de estudiante: recorta, colapsa espacios y exige entre 2 y 60 caracteres con alguna letra. */
export const normalizeStudentName = (raw: string): string => {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60) throw new Error('Escribe tu nombre completo (entre 2 y 60 caracteres).');
  if (!/\p{L}/u.test(name)) throw new Error('El nombre debe contener letras.');
  return name;
};

/** Clave estable para comparar nombres (sin mayúsculas ni acentos). */
export const studentKey = (name: string): string => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Siempre hay un PIN: el propio del navegador o el acordado por defecto. */
export const hasTeacherPin = (): boolean => true;
export const hasCustomTeacherPin = (): boolean => !!store.get(PIN_KEY);

export const setTeacherPin = async (pin: string): Promise<void> => {
  if (pin.length < 4 || pin.length > 32) throw new Error('El PIN debe tener entre 4 y 32 caracteres.');
  store.set(PIN_KEY, await sha256(`sonora:${pin}`));
};

export const verifyTeacherPin = async (pin: string): Promise<boolean> => {
  const stored = store.get(PIN_KEY) ?? DEFAULT_PIN_HASH;
  return stored === (await sha256(`sonora:${pin}`));
};

export const clearTeacherPin = () => store.remove(PIN_KEY);

export const loadSession = (): Session | null => {
  try {
    const raw = store.get(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (s.role === 'teacher') return { role: 'teacher', enteredAt: s.enteredAt ?? new Date().toISOString() };
    if (s.role === 'student' && typeof s.studentName === 'string') return { role: 'student', studentName: normalizeStudentName(s.studentName), enteredAt: s.enteredAt ?? new Date().toISOString() };
    return null;
  } catch { return null; }
};

export const saveSession = (s: Session) => store.set(SESSION_KEY, JSON.stringify(s));
export const clearSession = () => store.remove(SESSION_KEY);

export const teacherSession = (): Session => ({ role: 'teacher', enteredAt: new Date().toISOString() });
export const studentSession = (name: string): Session => ({ role: 'student', studentName: normalizeStudentName(name), enteredAt: new Date().toISOString() });
