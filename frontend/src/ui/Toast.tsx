import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import './Toast.css';

type Tipo = 'success' | 'error' | 'info';

/**
 * One optional action. A notification that says a delivery was assigned is worth
 * more with the way to open it, and more than one button turns a passing message
 * into a decision.
 */
export interface AccaoAviso {
  readonly label: string;
  readonly onClick: () => void;
}

interface Aviso {
  readonly id: number;
  readonly tipo: Tipo;
  readonly mensagem: string;
  readonly accao?: AccaoAviso;
}

interface Contexto {
  readonly sucesso: (mensagem: string, accao?: AccaoAviso) => void;
  /** Errors state the problem, never just "erro". */
  readonly erro: (mensagem: string, accao?: AccaoAviso) => void;
  readonly info: (mensagem: string, accao?: AccaoAviso) => void;
}

const ToastContext = createContext<Contexto | null>(null);

const ICONES: Record<Tipo, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

/** Errors stay until dismissed; confirmations disappear on their own. */
const DURACAO: Record<Tipo, number | null> = { success: 4000, info: 4000, error: null };

export const ToastProvider = ({ children }: { readonly children: ReactNode }) => {
  const [avisos, setAvisos] = useState<readonly Aviso[]>([]);

  const remover = useCallback((id: number) => {
    setAvisos((actuais) => actuais.filter((aviso) => aviso.id !== id));
  }, []);

  const adicionar = useCallback(
    (tipo: Tipo, mensagem: string, accao?: AccaoAviso) => {
      const id = Date.now() + Math.random();
      setAvisos((actuais) => [
        ...actuais,
        { id, tipo, mensagem, ...(accao !== undefined ? { accao } : {}) },
      ]);
      const duracao = DURACAO[tipo];
      if (duracao !== null) setTimeout(() => remover(id), duracao);
    },
    [remover],
  );

  const valor = useMemo<Contexto>(
    () => ({
      sucesso: (mensagem, accao) => adicionar('success', mensagem, accao),
      erro: (mensagem, accao) => adicionar('error', mensagem, accao),
      info: (mensagem, accao) => adicionar('info', mensagem, accao),
    }),
    [adicionar],
  );

  return (
    <ToastContext.Provider value={valor}>
      {children}
      <div className="toasts" role="region" aria-label="Notificações">
        {avisos.map((aviso) => {
          const Icone = ICONES[aviso.tipo];
          return (
            <div
              className="toast"
              data-tipo={aviso.tipo}
              key={aviso.id}
              role={aviso.tipo === 'error' ? 'alert' : 'status'}
            >
              <Icone size={18} className="toast__icone" aria-hidden="true" />
              <p className="toast__texto">{aviso.mensagem}</p>
              {aviso.accao !== undefined ? (
                <button
                  type="button"
                  className="toast__accao"
                  onClick={() => {
                    aviso.accao?.onClick();
                    remover(aviso.id);
                  }}
                >
                  {aviso.accao.label}
                </button>
              ) : null}
              <button
                type="button"
                className="toast__fechar"
                onClick={() => remover(aviso.id)}
                aria-label="Fechar aviso"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): Contexto => {
  const contexto = useContext(ToastContext);
  if (contexto === null) throw new Error('useToast exige <ToastProvider> acima na árvore.');
  return contexto;
};
