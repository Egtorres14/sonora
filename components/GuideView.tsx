import { ArrowLeft, BookOpen, CircleHelp, GraduationCap, UserRound } from 'lucide-react';

export type GuideRole = 'teacher' | 'student';
interface Props { role: GuideRole; onRole?: (role: GuideRole) => void; onBack?: () => void; backLabel?: string }

interface Step { title: string; text: string; tip?: string }
const TEACHER_STEPS: Step[] = [
  { title: 'Entra con el PIN de profesor', text: 'En la pantalla de entrada elige «Soy profesor» e introduce el PIN. La sesión se guarda en este navegador hasta que pulses «Salir».', tip: 'En un equipo compartido pulsa «Salir» al terminar: la sesión de profesor queda guardada en el navegador hasta que lo hagas.' },
  { title: 'Sube o recibe audios', text: 'En Laboratorio arrastra archivos WAV, AIFF o FLAC. Las entregas de los estudiantes aparecen en Biblioteca con su nombre y fecha. Nada sale del navegador: el audio se analiza y se guarda localmente.' },
  { title: 'Lee las mediciones', text: 'Cada archivo muestra loudness (LUFS), pico real, saturación, clics, silencios y espectro. Son medidas reales según ITU-R BS.1770; puntúan solas la parte técnica de la rúbrica.', tip: 'Pulsa una marca de la línea de tiempo o una fila de evidencias para escuchar justo ese momento.' },
  { title: 'Confirma cada herramienta', text: 'En «Criterio del profesor» marca presente, ausente o pendiente para pitch shift, time stretch, reversa, filtros y loops. Escribe la evidencia con tiempos («0:12–0:18») y aparecerá en la línea de tiempo.', tip: 'Con la fuente original en la biblioteca, elige una referencia en el panel de contexto para escuchar A/B.' },
  { title: 'Pide una segunda opinión', text: 'En Motores de IA eliges el modelo local (gratis, en tu equipo) o un proveedor externo con tu clave. Las sugerencias nunca cambian etiquetas ni notas: solo señalan dónde mirar.' },
  { title: 'Redacta el feedback y publica', text: '«Redactar borrador» convierte mediciones y anotaciones en un texto editable. Cuando la revisión esté completa, «Publicar al estudiante» le muestra nota y comentarios en «Mis entregas».' },
  { title: 'Ajusta la rúbrica', text: 'En Rúbrica puedes cambiar puntos, penalizaciones y herramientas obligatorias. Las notas de toda la biblioteca se recalculan con la rúbrica vigente.' },
  { title: 'Entrena el modelo local', text: 'En Muestras importa el corpus de ejemplo (900 variantes con etiqueta exacta) y carga el modelo ya entrenado, o entrena en Modelo local con tu propia colección etiquetada. La validación se hace por grabación de origen para no engañarte.' },
  { title: 'Exporta y comparte', text: 'Desde Biblioteca exporta CSV para tu hoja de notas o JSON para llevar la colección a otro equipo o contribuirla al repositorio.' },
];
const STUDENT_STEPS: Step[] = [
  { title: 'Entra con tu nombre', text: 'Escribe tu nombre completo tal y como quieres que lo vea tu profesor. Con ese nombre se identifican tus entregas; usa siempre el mismo.' },
  { title: 'Prepara el archivo', text: 'Exporta tu proyecto en WAV, AIFF o FLAC (no MP3). Ponle un nombre descriptivo, por ejemplo «apellido_nombre_proyecto1.wav». Máximo 200 MB.', tip: 'Deja al menos 1 dB de margen por debajo de 0 dBFS y evita cortes sin fundido: la app los detecta.' },
  { title: 'Entrega', text: 'En Entregar arrastra el archivo o pulsa para elegirlo. Se analiza en tu navegador; el audio se guarda en este equipo y el profesor lo verá cuando lo abra aquí.' },
  { title: 'Escribe la sinopsis', text: 'Cuenta qué querías conseguir y qué procesos usaste (pitch shift, time stretch, reversa, filtros, loops, otros). La sinopsis puntúa y ayuda al profesor a encontrar cada proceso.' },
  { title: 'Mira las mediciones', text: 'Verás nivel, pico real, saturación y clics con el momento exacto. Si algo sale mal puedes corregir el proyecto y volver a entregar antes de que lo revisen.' },
  { title: 'Lectura orientativa', text: 'Si tu profesor la ha activado, puedes pedir una lectura de un modelo de IA: qué se oye, fortalezas y mejoras. No es una nota ni sustituye la revisión del profesor.' },
  { title: 'Consulta tu calificación', text: 'En Mis entregas aparecerá «Publicada» cuando el profesor termine. Ahí verás la nota, el desglose por criterios y su feedback.' },
];

export default function GuideView({ role, onRole, onBack, backLabel = 'Volver' }: Props) {
  const steps = role === 'teacher' ? TEACHER_STEPS : STUDENT_STEPS;
  return <div className="guide-view">
    {onBack && <button type="button" className="text-button guide-back" onClick={onBack}><ArrowLeft size={14} /> {backLabel}</button>}
    <div className="page-title"><span className="eyebrow">TUTORIAL DE USO</span><h2>{role === 'teacher' ? <>Del archivo a la nota,<br /><em>paso a paso.</em></> : <>Entregar bien<br />es <em>fácil.</em></>}</h2><p>{role === 'teacher' ? 'Todo ocurre en tu navegador. Esta guía recorre el flujo completo: recibir, medir, confirmar, redactar y publicar.' : 'Sigue estos pasos y tu profesor recibirá tu proyecto con las mediciones y tu sinopsis.'}</p></div>
    {onRole && <div className="segmented guide-roles" role="group" aria-label="Guía para"><button type="button" aria-pressed={role === 'teacher'} className={role === 'teacher' ? 'selected' : ''} onClick={() => onRole('teacher')}><GraduationCap size={13} /> Profesor</button><button type="button" aria-pressed={role === 'student'} className={role === 'student' ? 'selected' : ''} onClick={() => onRole('student')}><UserRound size={13} /> Estudiante</button></div>}
    <ol className="guide-steps">
      {steps.map((s, i) => <li className="guide-step guide-card" key={s.title}><span>{String(i + 1).padStart(2, '0')}</span><div><h4>{s.title}</h4><p>{s.text}</p>{s.tip && <p className="guide-tip"><CircleHelp size={13} /> {s.tip}</p>}</div></li>)}
    </ol>
    <div className="method-note"><BookOpen size={20} /><p>{role === 'teacher' ? <><b>Qué mide y qué no.</b> Las mediciones técnicas son exactas y reproducibles. La detección de procesos creativos (pitch, stretch, reversa, filtros, loops) es siempre una sugerencia que confirmas tú: el modelo local se abstiene cuando no está seguro y los proveedores externos opinan, no deciden.</> : <><b>Sobre tu privacidad.</b> Tu audio no se sube a ningún servidor: se analiza y se guarda en el navegador del equipo donde entregas. Si pides una lectura de IA externa, se envían las mediciones y tu sinopsis, no el audio.</>}</p></div>
  </div>;
}
