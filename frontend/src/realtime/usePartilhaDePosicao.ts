import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from './RealtimeContext';

export type EstadoPartilha =
  | 'inactiva'
  | 'a-pedir-permissao'
  | 'activa'
  | 'sem-permissao'
  | 'sem-suporte'
  | 'sem-sinal';

/** A point every ten seconds is enough to follow a van through city traffic. */
const INTERVALO_MS = 10_000;

interface Partilha {
  readonly estado: EstadoPartilha;
  readonly ultimoEnvio: Date | null;
  readonly recusa: string | null;
  readonly comecar: () => void;
  readonly parar: () => void;
}

/**
 * Sharing the driver's position, for as long as he chooses to.
 *
 * Three things this deliberately does not do. It does not start on its own: a phone
 * that reports its location without being asked is surveillance, whoever owns it. It
 * does not pretend to work in the background — a browser stops `watchPosition` when
 * the tab goes away, so the interface says the sharing lasts while the page is open
 * rather than letting a driver believe he is visible when he is not. And it does not
 * queue points that failed to send: a position from four minutes ago has no value, so
 * the next one simply replaces it.
 */
export const usePartilhaDePosicao = (): Partilha => {
  const { socket, estado: ligacao } = useRealtime();
  const [estado, setEstado] = useState<EstadoPartilha>('inactiva');
  const [ultimoEnvio, setUltimoEnvio] = useState<Date | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);
  const vigia = useRef<number | null>(null);
  const ultimo = useRef(0);
  const activa = useRef(false);

  const parar = useCallback(() => {
    activa.current = false;
    if (vigia.current !== null) {
      // Optional, because the hook itself has a `sem-suporte` state: stopping must
      // work on the browser that could never start.
      navigator.geolocation?.clearWatch(vigia.current);
      vigia.current = null;
    }
    setEstado('inactiva');
  }, []);

  const comecar = useCallback(() => {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      setEstado('sem-suporte');
      return;
    }

    activa.current = true;
    setRecusa(null);
    setEstado('a-pedir-permissao');

    vigia.current = navigator.geolocation.watchPosition(
      (posicao) => {
        if (!activa.current) return;
        setEstado('activa');

        // The browser reports as often as the hardware allows; the wire does not need
        // it. This is a driver's data bundle and battery being spent.
        const agora = Date.now();
        if (agora - ultimo.current < INTERVALO_MS) return;
        ultimo.current = agora;

        socket?.emit(
          'posicao',
          {
            latitude: posicao.coords.latitude,
            longitude: posicao.coords.longitude,
            accuracyMeters: posicao.coords.accuracy,
          },
          (resposta: { ok: boolean; message?: string; ignored?: boolean }) => {
            if (resposta.ok) {
              if (resposta.ignored !== true) setUltimoEnvio(new Date());
              setRecusa(null);
              return;
            }
            // The server's reason is shown as it came: "fora de Angola" tells the
            // driver something a generic failure would not.
            setRecusa(resposta.message ?? 'A posição não foi aceite.');
          },
        );
      },
      (erro) => {
        if (!activa.current) return;
        activa.current = false;
        vigia.current = null;
        setEstado(erro.code === erro.PERMISSION_DENIED ? 'sem-permissao' : 'sem-sinal');
      },
      // High accuracy is the point of the feature; a 30 second maximum age keeps a
      // cached fix from being reported as a current one.
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
  }, [socket]);

  // Sharing without a socket would collect points and send them nowhere, so the
  // interface stops claiming to share and says why.
  useEffect(() => {
    if (activa.current && ligacao !== 'ligado') setEstado('sem-sinal');
  }, [ligacao]);

  useEffect(() => parar, [parar]);

  return { estado, ultimoEnvio, recusa, comecar, parar };
};
