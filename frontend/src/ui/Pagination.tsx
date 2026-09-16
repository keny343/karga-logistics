import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import './Pagination.css';

interface Props {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onChange: (pagina: number) => void;
}

export const Pagination = ({ page, pageSize, total, onChange }: Props) => {
  const paginas = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const primeiro = (page - 1) * pageSize + 1;
  const ultimo = Math.min(page * pageSize, total);

  return (
    <nav className="paginacao" aria-label="Paginação">
      <p className="paginacao__contagem">
        {primeiro}–{ultimo} de {total}
      </p>
      <div className="paginacao__botoes">
        <Button
          size="sm"
          icon={<ChevronLeft size={16} />}
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Página anterior"
        />
        <span className="paginacao__pagina">
          {page} / {paginas}
        </span>
        <Button
          size="sm"
          icon={<ChevronRight size={16} />}
          disabled={page >= paginas}
          onClick={() => onChange(page + 1)}
          aria-label="Página seguinte"
        />
      </div>
    </nav>
  );
};
