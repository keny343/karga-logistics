import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

interface Props {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly onClose: () => void;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Escape closes, the backdrop closes, focus moves into the dialog on open and
 * cannot leave it while it is up. Without the focus trap a keyboard user tabs
 * into the page behind and has no idea where they are.
 */
export const Modal = ({ open, title, description, onClose, footer, children }: Props) => {
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const anterior = document.activeElement as HTMLElement | null;
    caixa.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    )?.focus();

    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') {
        onClose();
        return;
      }
      if (evento.key !== 'Tab' || caixa.current === null) return;

      const focaveis = caixa.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (primeiro === undefined || ultimo === undefined) return;

      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    };

    document.addEventListener('keydown', aoTeclar);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
      anterior?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal__fundo" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={caixa}
        onMouseDown={(evento) => evento.stopPropagation()}
      >
        <header className="modal__cabecalho">
          <div>
            <h2 className="modal__titulo">{title}</h2>
            {description !== undefined ? <p className="modal__descricao">{description}</p> : null}
          </div>
          <button type="button" className="modal__fechar" onClick={onClose} aria-label="Fechar">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="modal__corpo">{children}</div>
        {footer !== undefined ? <footer className="modal__acoes">{footer}</footer> : null}
      </div>
    </div>
  );
};
