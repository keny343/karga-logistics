import { useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { ApiError, api, type Order } from '../api/client';
import { CENTRO_LUANDA } from '../domain/geografia';
import { statusTone } from '../domain/orderStatus';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LeafletMap, type MarcadorMapa } from '../ui/LeafletMap';
import { useToast } from '../ui/Toast';
import './DestinoNoMapa.css';

interface Props {
  readonly encomenda: Order;
  readonly podeEditar: boolean;
  readonly onGuardado: () => void;
}

/**
 * Where the parcel is going, and — for an operator — where it actually is.
 *
 * Coordinates are set by hand rather than geocoded because an address in Luanda is
 * usually a description and a landmark: "Via S8, loja 4, em frente ao Talatona
 * Imperial" is exactly how somebody finds it and exactly what a geocoder cannot
 * resolve. The operator who knows the place drops the pin, and the written address
 * is never overwritten by it.
 */
export const DestinoNoMapa = ({ encomenda, podeEditar, onGuardado }: Props) => {
  const aviso = useToast();
  const [pendente, setPendente] = useState<{ latitude: number; longitude: number } | null>(null);
  const [aGuardar, setAGuardar] = useState(false);

  const destino = encomenda.destinationAddress;
  // Memoised because the marker list depends on it, and a new object on every render
  // would rebuild the markers and throw the operator's pan and zoom away mid-click.
  const actual = useMemo(
    () =>
      destino.latitude !== undefined && destino.longitude !== undefined
        ? { latitude: destino.latitude, longitude: destino.longitude }
        : null,
    [destino.latitude, destino.longitude],
  );

  const marcadores = useMemo<readonly MarcadorMapa[]>(() => {
    const lista: MarcadorMapa[] = [];

    if (actual !== null) {
      lista.push({
        id: encomenda.id,
        latitude: actual.latitude,
        longitude: actual.longitude,
        tone: statusTone(encomenda.status),
        label: encomenda.code.replace('KRG-', ''),
        popup: `<span class="popup__codigo">Destino actual</span>`,
      });
    }

    // The proposed point is drawn beside the current one, not instead of it: the
    // operator has to see how far the pin moved before committing to it.
    if (pendente !== null) {
      lista.push({
        id: 'pendente',
        latitude: pendente.latitude,
        longitude: pendente.longitude,
        tone: 'warning',
        label: 'Novo',
        popup: `<span class="popup__codigo">Ponto por confirmar</span>`,
      });
    }

    return lista;
  }, [actual, pendente, encomenda.id, encomenda.code, encomenda.status]);

  const guardar = async (): Promise<void> => {
    if (pendente === null) return;
    setAGuardar(true);
    try {
      await api.setOrderCoordinates(encomenda.id, pendente);
      aviso.sucesso('Destino marcado no mapa.');
      setPendente(null);
      onGuardado();
    } catch (falha) {
      // The API names the mistake — swapped coordinates, a finished order — and that
      // sentence is what the operator needs.
      aviso.erro(
        falha instanceof ApiError ? falha.message : 'Não foi possível guardar o ponto.',
      );
    } finally {
      setAGuardar(false);
    }
  };

  return (
    <Card
      title="Destino no mapa"
      actions={
        pendente !== null ? (
          <div className="destino__acoes">
            <Button onClick={() => setPendente(null)} disabled={aGuardar}>
              Descartar
            </Button>
            <Button variant="primary" loading={aGuardar} onClick={() => void guardar()}>
              Guardar ponto
            </Button>
          </div>
        ) : undefined
      }
    >
      {actual === null && !podeEditar ? (
        <p className="destino__nota">
          <MapPin size={14} aria-hidden="true" />
          Esta encomenda ainda não tem ponto marcado no mapa.
        </p>
      ) : (
        <>
          <LeafletMap
            ariaLabel={`Destino da encomenda ${encomenda.code}`}
            marcadores={marcadores}
            centro={actual ?? CENTRO_LUANDA}
            zoom={actual !== null ? 14 : 11}
            height="280px"
            {...(podeEditar ? { onEscolherPonto: setPendente } : {})}
          />
          {podeEditar ? (
            <p className="destino__nota">
              <MapPin size={14} aria-hidden="true" />
              {actual === null
                ? 'Clica no mapa para marcar onde a encomenda deve ser entregue.'
                : 'Clica no mapa para corrigir o ponto. O endereço escrito não muda.'}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
};
