import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import './Toast.css';

type Tipo = 'success' | 'error' | 'info';

interface Aviso {
  readonly id: number;
  readonly tipo: Tipo;
  readonly mensagem: string;
}

interface Contexto {
  readonly sucesso: (mensagem: string) => void;
  /** Errors state the problem, never just "erro". */
  readonly erro: (mensagem: string) => void;
  readonly info: (mensagem: string) => void;
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
    (tipo: Tipo, mensagem: string) => {
      const id = Date.now() + Math.random();
      setAvisos((actuais) => [...actuais, { id, tipo, mensagem }]);
      const duracao = DURACAO[tipo];
      if (duracao !== null) setTimeout(() => remover(id), duracao);
    },
    [remover],
  );

  const valor = useMemo<Contexto>(
    () => ({
      sucesso: (mensagem) => adicionar('success', mensagem),
      erro: (mensagem) => adicionar('error', mensagem),
      info: (mensagem) => adicionar('info', mensagem),
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
