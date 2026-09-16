import React from 'react';
import { downloadFile, exportDataset, library } from '../services/library';

/**
 * Red de seguridad. Un fallo de render en cualquier panel dejaba la página en blanco, sin forma de
 * recuperar ni de sacar el trabajo. Aquí el profesor puede, como mínimo, descargar la colección
 * (mediciones, etiquetas y notas) antes de recargar.
 */
interface State { error: Error | null; saved: 'idle' | 'saving' | 'done' | 'failed' }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, saved: 'idle' };

  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('Sonora: fallo no controlado', error, info.componentStack); }

  private rescue = async () => {
    this.setState({ saved: 'saving' });
    try {
      const records = await library.list();
      downloadFile(exportDataset(records), `sonora-copia-${new Date().toISOString().slice(0, 10)}.json`);
      this.setState({ saved: 'done' });
    } catch { this.setState({ saved: 'failed' }); }
  };

  render() {
    const { error, saved } = this.state;
    if (!error) return this.props.children;
    return <div className="crash-screen" role="alert">
      <span className="eyebrow">ALGO HA FALLADO</span>
      <h2>La aplicación se ha detenido.</h2>
      <p>Tus muestras siguen guardadas en este navegador. Antes de recargar puedes descargar una copia de la colección: incluye mediciones, etiquetas y notas, pero no el audio.</p>
      <div className="toolbar">
        <button className="button primary" disabled={saved === 'saving'} onClick={this.rescue}>{saved === 'saving' ? 'Preparando la copia…' : 'Descargar copia de la colección'}</button>
        <button className="button secondary" onClick={() => window.location.reload()}>Recargar la aplicación</button>
      </div>
      {saved === 'done' && <p className="notice">Copia descargada. Puedes volver a importarla desde Biblioteca.</p>}
      {saved === 'failed' && <p className="error-text">No se ha podido leer el almacenamiento local para hacer la copia.</p>}
      <details className="crash-details"><summary>Detalle técnico</summary><pre>{error.message}</pre></details>
    </div>;
  }
}
