import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full py-4 px-8 border-t border-brand-border mt-8">
      <div className="container mx-auto text-center text-sm text-brand-text-secondary">
        <p>Métricas medidas en tu navegador (ITU-R BS.1770-4 / EBU R128). Juicio creativo con Gemini, OpenAI o Claude. Creado para fines educativos.</p>
      </div>
    </footer>
  );
};
