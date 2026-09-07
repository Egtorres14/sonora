import React, { useCallback, useState } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  disabled: boolean;
}

const ACCEPTED_EXTENSIONS = ['.wav', '.wave', '.aiff', '.aif', '.aifc', '.flac'];
const ACCEPTED_ATTR = ACCEPTED_EXTENSIONS.join(',');
const MAX_BYTES = 200 * 1024 * 1024;

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const validateAndSelectFile = useCallback((file: File | undefined | null) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    // Muchos navegadores dejan `file.type` vacío para .aiff o .flac: validamos por extensión.
    if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      setMessage(`"${file.name}" no es un formato admitido. Usa WAV, AIFF o FLAC.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setMessage(`El archivo pesa ${(file.size / 1e6).toFixed(0)} MB; el máximo es ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    setMessage(null);
    onFileSelect(file);
  }, [onFileSelect]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => validateAndSelectFile(event.target.files?.[0]);
  const prevent = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div className="w-full max-w-xl mx-auto text-center">
      <h2 className="text-3xl font-bold mb-2 text-brand-text">Evaluador de proyectos de audio</h2>
      <p className="text-brand-text-secondary mb-6">Sube el archivo del estudiante. Las medidas técnicas se calculan en tu navegador; el juicio creativo lo hace el modelo que elijas.</p>
      <label
        htmlFor="audio-upload"
        onDragEnter={(e) => { prevent(e); setIsDragging(true); }}
        onDragLeave={(e) => { prevent(e); setIsDragging(false); }}
        onDragOver={prevent}
        onDrop={(e) => { prevent(e); setIsDragging(false); validateAndSelectFile(e.dataTransfer.files?.[0]); }}
        className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer bg-brand-surface hover:bg-opacity-80 transition-all duration-300
          ${isDragging ? 'border-brand-primary scale-[1.02]' : 'border-brand-border'}
          ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <svg className="w-10 h-10 mb-4 text-brand-text-secondary" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2" />
          </svg>
          <p className="mb-2 text-sm text-brand-text-secondary"><span className="font-semibold text-brand-text">Haz clic para subir</span> o arrastra y suelta</p>
          <p className="text-xs text-brand-text-secondary">WAV, AIFF o FLAC · hasta {Math.round(MAX_BYTES / 1024 / 1024)} MB</p>
        </div>
        <input id="audio-upload" type="file" className="hidden" accept={ACCEPTED_ATTR} onChange={handleFileChange} disabled={disabled} />
      </label>
      {message && <p role="alert" className="mt-3 text-sm text-red-300">{message}</p>}
    </div>
  );
};

export default FileUpload;
