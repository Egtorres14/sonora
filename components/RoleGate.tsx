import { useState, type FormEvent } from 'react';
import { ArrowRight, GraduationCap, KeyRound, LockKeyhole, UserRound, BookOpen } from 'lucide-react';
import { verifyTeacherPin, studentSession, teacherSession, type Session } from '../services/session';

interface Props { onEnter: (session: Session) => void; onGuide?: () => void }

export default function RoleGate({ onEnter, onGuide }: Props) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [studentError, setStudentError] = useState('');
  const [teacherError, setTeacherError] = useState('');
  const [busy, setBusy] = useState(false);

  const enterStudent = (e: FormEvent) => {
    e.preventDefault();
    try { onEnter(studentSession(name)); } catch (err) { setStudentError(err instanceof Error ? err.message : 'Nombre no válido.'); }
  };
  const enterTeacher = async (e: FormEvent) => {
    e.preventDefault();
    setTeacherError(''); setBusy(true);
    try {
      if (!(await verifyTeacherPin(pin))) throw new Error('PIN incorrecto.');
      onEnter(teacherSession());
    } catch (err) { setTeacherError(err instanceof Error ? err.message : 'No se pudo entrar.'); }
    finally { setBusy(false); }
  };

  return <div className="role-gate">
    <div className="role-gate-inner">
      <div className="role-brand"><span className="brand-bars" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} style={{ animationDelay: `${i * 0.18}s` }} />)}</span><span>sonora<span className="brand-dot">.</span><small>LABORATORIO DE AUDIO</small></span></div>
      <h1>¿Quién entra?</h1>
      <p className="role-lead">Los estudiantes suben su proyecto y ven su entrega. El profesorado revisa, califica y gestiona la biblioteca y la rúbrica.</p>
      <div className="role-panels">
        <form className="role-panel" onSubmit={enterStudent} aria-labelledby="role-student">
          <div className="role-panel-icon"><GraduationCap size={22} /></div>
          <h2 id="role-student">Estudiante</h2>
          <p>Escribe tu nombre tal como aparece en la lista de clase. Aparecerá junto a tu archivo y a tu calificación.</p>
          <label className="field">Nombre y apellidos<input value={name} autoComplete="name" maxLength={60} placeholder="Ej.: María Pérez" onChange={e => { setName(e.target.value); setStudentError(''); }} /></label>
          {studentError && <p className="role-error" role="alert">{studentError}</p>}
          <button className="button primary" type="submit" disabled={!name.trim()}>Entrar como estudiante <ArrowRight size={16} /></button>
        </form>
        <form className="role-panel" onSubmit={enterTeacher} aria-labelledby="role-teacher">
          <div className="role-panel-icon"><UserRound size={22} /></div>
          <h2 id="role-teacher">Profesor</h2>
          <p>Introduce el PIN del profesor.</p>
          <label className="field">PIN<input type="password" value={pin} autoComplete="current-password" maxLength={32} onChange={e => { setPin(e.target.value); setTeacherError(''); }} /></label>
          {teacherError && <p className="role-error" role="alert">{teacherError}</p>}
          <button className="button secondary" type="submit" disabled={busy || pin.length < 4}><KeyRound size={15} /> Entrar como profesor</button>
        </form>
      </div>
      {onGuide && <p className="role-guide"><button type="button" className="text-button" onClick={onGuide}><BookOpen size={14} /> ¿Cómo se usa? Tutorial para profesor y estudiante</button></p>}
      <p className="role-footnote"><LockKeyhole size={13} /> Todo se guarda en este navegador. El PIN separa los espacios en un equipo compartido; no es una cuenta ni protege frente a quien borre los datos del navegador.</p>
    </div>
  </div>;
}
