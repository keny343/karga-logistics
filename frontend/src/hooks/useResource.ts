import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

interface Estado<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: ApiError | null;
  /** True while a reload runs over data that is already on screen. */
  readonly refreshing: boolean;
  readonly reload: () => void;
}

const inesperado = (): ApiError =>
  new ApiError(0, { error: { code: 'UNEXPECTED_ERROR', message: 'Erro inesperado.' } });

/**
 * One loading pattern for every screen. The first fetch shows a skeleton; a later
 * one keeps the previous data visible and only marks itself as refreshing, so
 * changing a filter does not blank the table the operator is reading.
 *
 * Whether data is already present is tracked in a ref: reading it from state
 * inside the effect would either add it to the dependencies and re-fetch forever,
 * or require deciding inside a state updater, which has to stay pure.
 */
export const useResource = <T>(buscar: () => Promise<T>, deps: readonly unknown[]): Estado<T> => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [contador, setContador] = useState(0);

  const temDados = useRef(false);
  const reload = useCallback(() => setContador((valor) => valor + 1), []);

  useEffect(() => {
    let activo = true;

    if (temDados.current) setRefreshing(true);
    else setLoading(true);

    buscar()
      .then((resultado) => {
        if (!activo) return;
        temDados.current = true;
        setData(resultado);
        setError(null);
      })
      .catch((erro: unknown) => {
        if (!activo) return;
        setError(erro instanceof ApiError ? erro : inesperado());
      })
      .finally(() => {
        if (!activo) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      activo = false;
    };
    // The caller declares what the fetch depends on; `buscar` is recreated on every
    // render and including it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, contador]);

  return { data, loading, error, refreshing, reload };
};
