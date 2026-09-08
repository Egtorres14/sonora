import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  position: 'top' | 'bottom';
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

export default function LibraryPagination({ page, pageSize, total, position, onPage, onPageSize }: Props) {
  if (!total) return null;
  const pages = Math.ceil(total / pageSize);
  const pageNumbers = [...new Set([1, page - 1, page, page + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  return <div className="library-pagination">
    <div className="pagination-summary">
      <p aria-live={position === 'top' ? 'polite' : undefined}>Mostrando <b>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</b> de <b>{total.toLocaleString('es')}</b> muestras</p>
      {position === 'top' && <label>Muestras por página<select aria-label="Muestras por página" value={pageSize} onChange={e => onPageSize(Number(e.target.value))}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>}
      {position === 'bottom' && <span className="muted">Página {page} de {pages}</span>}
    </div>
    <nav className="pagination-controls" aria-label={`Paginación de biblioteca (${position === 'top' ? 'superior' : 'inferior'})`}>
      <button className="pagination-arrow" aria-label="Página anterior" disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={17} /></button>
      {pageNumbers.map((number, index) => <span className="pagination-item" key={number}>
        {index > 0 && number - pageNumbers[index - 1] > 1 && <span className="pagination-gap" aria-hidden="true">…</span>}
        <button aria-label={`Página ${number}`} aria-current={number === page ? 'page' : undefined} onClick={() => onPage(number)}>{number}</button>
      </span>)}
      <button className="pagination-arrow" aria-label="Página siguiente" disabled={page === pages} onClick={() => onPage(page + 1)}><ChevronRight size={17} /></button>
    </nav>
  </div>;
}
