import { useState, type FormEvent } from 'react';
import { ArrowRight, AudioLines, GraduationCap, KeyRound, LockKeyhole, UserRound } from 'lucide-react';
import { hasTeacherPin, setTeacherPin, verifyTeacherPin, studentSession, teacherSession, type Session } from '../services/session';

interface Props { onEnter: (session: Session) => void }

export default function RoleGate({ onEnter }: Props) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [studentError, setStudentError] = useState('');
  const [teacherError, setTeacherError] = useState('');
  const [busy, setBusy] = useState(false);
  const firstTime = !hasTeacherPin();

  const enterStudent = (e: FormEvent) => {
    e.preventDefault();
    try { onEnter(studentSession(name)); } catch (err) { setStudentError(err instanceof Error ? err.message : 'Nombre no válido.'); }
  };
  const enterTeacher = async (e: FormEvent) => {
    e.preventDefault();
    setTeacherError(''); setBusy(true);
    try {
      if (firstTime) {
        if (pin !== pinConfirm) throw new Error('Los dos PIN no coinciden.');
        await setTeacherPin(pin);
      } else if (!(await verifyTeacherPin(pin))) throw new Error('PIN incorrecto.');
      onEnter(teacherSession());
    } catch (err) { setTeacherError(err instanceof Error ? err.message : 'No se pudo entrar.'); }
    finally { setBusy(false); }
  };

  return <div className="role-gate">
    <div className="role-gate-inner">
      <div className="role-brand"><AudioLines size={34} strokeWidth={1.5} /><span>sonora<span className="brand-dot">.</span><small>LABORATORIO DE AUDIO</small></span></div>
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
          <p>{firstTime ? 'Primera vez en este navegador: crea un PIN para proteger la vista del profesor.' : 'Introduce el PIN del profesor.'}</p>
          <label className="field">{firstTime ? 'Nuevo PIN (4–32 caracteres)' : 'PIN'}<input type="password" value={pin} autoComplete={firstTime ? 'new-password' : 'current-password'} maxLength={32} onChange={e => { setPin(e.target.value); setTeacherError(''); }} /></label>
          {firstTime && <label className="field">Repite el PIN<input type="password" value={pinConfirm} autoComplete="new-password" maxLength={32} onChange={e => { setPinConfirm(e.target.value); setTeacherError(''); }} /></label>}
          {teacherError && <p className="role-error" role="alert">{teacherError}</p>}
          <button className="button secondary" type="submit" disabled={busy || pin.length < 4}><KeyRound size={15} /> {firstTime ? 'Crear PIN y entrar' : 'Entrar como profesor'}</button>
        </form>
      </div>
      <p className="role-footnote"><LockKeyhole size={13} /> Todo se guarda en este navegador. El PIN separa los espacios en un equipo compartido; no es una cuenta ni protege frente a quien borre los datos del navegador.</p>
    </div>
  </div>;
}
