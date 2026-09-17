import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapPinOff, RefreshCw } from 'lucide-react';
import { api, type MapaOperacao, type PontoMapa, type PosicaoMotorista } from '../api/client';
import { useEventoTempoReal, useRecarregarCom } from '../realtime/RealtimeContext';
import { desdeQuando } from '../utils/format';
import { ORDER_STATUSES, statusLabel, statusTone } from '../domain/orderStatus';
import { useResource } from '../hooks/useResource';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Select } from '../ui/Field';
import { LeafletMap, type MarcadorMapa } from '../ui/LeafletMap';
import { PageHeader } from '../ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../ui/States';
import { Table, type TableColumn } from '../ui/Table';
import { StatusBadge } from '../ui/Badge';
import './MapaOperacional.css';

/**
 * Anything that reaches a Leaflet popup is HTML, so every value that came from a
 * form goes through here first. A customer named `<img onerror=…>` is a form
 * somebody filled in, not a hypothetical.
 */
const escapar = (texto: string): string =>
  texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const linhaEstado = (ponto: PontoMapa): string =>
  `${escapar(statusLabel(ponto.status))}${
    ponto.driverName !== undefined ? ` · ${escapar(ponto.driverName)}` : ''
  }${ponto.late ? ' · atrasada' : ''}`;

const popupDe = (ponto: PontoMapa): string =>
  [
    `<span class="popup__codigo">${escapar(ponto.code)}</span>`,
    `<span class="popup__linha">${escapar(ponto.customerName)}</span>`,
    `<span class="popup__linha">${escapar(ponto.municipality)} — ${escapar(ponto.description)}</span>`,
    `<span class="popup__linha">${linhaEstado(ponto)}</span>`,
    `<a class="popup__ligacao" href="/encomendas/${ponto.id}" data-abrir>Abrir encomenda</a>`,
  ].join('');

/**
 * Several parcels going to the same address are one pin, not five stacked on top of
 * each other. Without this the map draws five markers, the counter says ten, and the
 * dispatcher trusts the markers.
 */
const popupDeGrupo = (pontos: readonly PontoMapa[]): string => {
  const primeiro = pontos[0];
  if (primeiro === undefined) return '';

  return [
    `<span class="popup__codigo">${pontos.length} encomendas neste ponto</span>`,
    `<span class="popup__linha">${escapar(primeiro.municipality)} — ${escapar(
      primeiro.description,
    )}</span>`,
    '<ul class="popup__lista">',
    ...pontos.map(
      (ponto) =>
        `<li><a href="/encomendas/${ponto.id}" data-abrir="${ponto.id}">${escapar(
          ponto.code,
        )}</a> <span class="popup__linha">${linhaEstado(ponto)}</span></li>`,
    ),
    '</ul>',
  ].join('');
};

/** The pin has one colour, so it takes the one that most needs attention. */
const tomDoGrupo = (pontos: readonly PontoMapa[]): 'danger' | 'warning' | 'info' | 'neutral' => {
  if (pontos.some((ponto) => ponto.late || ponto.status === 'FALHA_ENTREGA')) return 'danger';
  if (pontos.some((ponto) => statusTone(ponto.status) === 'warning')) return 'warning';
  return 'info';
};

const agruparPorPonto = (pontos: readonly PontoMapa[]): PontoMapa[][] => {
  const grupos = new Map<string, PontoMapa[]>();

  for (const ponto of pontos) {
    // Coordinates are numeric(9,6) in the database, so equal points are exactly
    // equal here — no tolerance needed, and none invented.
    const chave = `${ponto.latitude},${ponto.longitude}`;
    const grupo = grupos.get(chave);
    if (grupo === undefined) grupos.set(chave, [ponto]);
    else grupo.push(ponto);
  }

  return [...grupos.values()];
};

const COLUNAS: readonly TableColumn<MapaOperacao['withoutCoordinates'][number]>[] = [
  {
    key: 'code',
    header: 'Encomenda',
    render: (linha) => (
      <Link className="mono" to={`/encomendas/${linha.id}`}>
        {linha.code}
      </Link>
    ),
  },
  { key: 'cliente', header: 'Cliente', render: (linha) => linha.customerName },
  {
    key: 'destino',
    header: 'Destino',
    secondary: true,
    render: (linha) => `${linha.municipality} — ${linha.description}`,
  },
  { key: 'estado', header: 'Estado', render: (linha) => <StatusBadge status={linha.status} /> },
];

const LEGENDA: readonly {
  readonly tone: 'info' | 'warning' | 'danger' | 'neutral';
  readonly label: string;
  readonly kind?: 'origem' | 'motorista';
}[] = [
  { tone: 'warning', label: 'Em armazém' },
  { tone: 'info', label: 'A caminho' },
  { tone: 'danger', label: 'Atrasada ou falhada' },
  { tone: 'neutral', label: 'Ponto de recolha', kind: 'origem' },
  { tone: 'neutral', label: 'Motorista', kind: 'motorista' },
];

const primeiroNome = (nome: string): string => nome.split(' ')[0] ?? nome;

/**
 * A position is what a phone claimed, and the popup says so: when it was reported and
 * how wide the circle was. A pin drawn from a point with a 2 km radius is not where
 * the driver is, and the operator deciding whether to call him needs to know which
 * kind of point he is looking at.
 */
const popupDeMotorista = (posicao: PosicaoMotorista): string =>
  [
    `<span class="popup__codigo">${escapar(posicao.driverName)}</span>`,
    posicao.orderCode !== undefined
      ? `<span class="popup__linha">A transportar ${escapar(posicao.orderCode)}</span>`
      : '<span class="popup__linha">Sem entrega activa</span>',
    `<span class="popup__linha">Reportado ${escapar(desdeQuando(posicao.reportedAt))}</span>`,
    posicao.accuracyMeters !== undefined
      ? `<span class="popup__linha">Precisão ${escapar(String(posicao.accuracyMeters))} m</span>`
      : '',
    posicao.orderId !== undefined
      ? `<a class="popup__ligacao" href="/encomendas/${posicao.orderId}" data-abrir="${posicao.orderId}">Abrir encomenda</a>`
      : '',
  ].join('');

export const MapaOperacional = () => {
  const navegar = useNavigate();
  const [estado, setEstado] = useState('');
  const { data, loading, error, refreshing, reload } = useResource(() => api.map(), []);

  /**
   * Positions the socket has delivered since the page opened. They are kept apart from
   * `data` on purpose: a driver reporting every ten seconds must not invalidate the
   * orders the screen is showing, and the orders being refetched must not throw away a
   * position that arrived in the meantime.
   */
  const [recebidas, setRecebidas] = useState<ReadonlyMap<string, PosicaoMotorista>>(new Map());

  useEventoTempoReal<PosicaoMotorista>('motorista:posicao', (posicao) => {
    setRecebidas((actuais) => new Map(actuais).set(posicao.driverId, posicao));
  });

  // The response is the fleet as it stood when the page loaded; anything that arrived
  // afterwards is newer and wins.
  const posicoes = useMemo(() => {
    const juntas = new Map(data?.drivers.map((posicao) => [posicao.driverId, posicao]) ?? []);
    for (const [id, posicao] of recebidas) juntas.set(id, posicao);
    return juntas;
  }, [data, recebidas]);

  // Orders are refetched, positions are not: a parcel changing state may change which
  // pins belong here, while a driver moving only moves one pin.
  useRecarregarCom('encomenda:actualizada', reload);

  const visiveis = useMemo<readonly PontoMapa[]>(() => {
    if (data === null) return [];
    return estado === '' ? data.items : data.items.filter((ponto) => ponto.status === estado);
  }, [data, estado]);

  const marcadores = useMemo<readonly MarcadorMapa[]>(() => {
    if (data === null) return [];

    const encomendas: MarcadorMapa[] = agruparPorPonto(visiveis).map((grupo) => {
      const primeiro = grupo[0] as PontoMapa;

      if (grupo.length === 1) {
        return {
          id: primeiro.id,
          latitude: primeiro.latitude,
          longitude: primeiro.longitude,
          // A late parcel is drawn as late whatever state it is in: on a map, the
          // thing that needs attention has to be the thing that stands out.
          tone: primeiro.late ? 'danger' : statusTone(primeiro.status),
          label: primeiro.code.replace('KRG-', ''),
          popup: popupDe(primeiro),
        };
      }

      return {
        id: primeiro.id,
        latitude: primeiro.latitude,
        longitude: primeiro.longitude,
        tone: tomDoGrupo(grupo),
        label: `${grupo.length} aqui`,
        popup: popupDeGrupo(grupo),
      };
    });

    const motoristas: MarcadorMapa[] = [...posicoes.values()].map((posicao) => ({
      id: `motorista-${posicao.driverId}`,
      latitude: posicao.latitude,
      longitude: posicao.longitude,
      tone: 'neutral',
      label: primeiroNome(posicao.driverName),
      kind: 'motorista',
      popup: popupDeMotorista(posicao),
    }));

    const origens: MarcadorMapa[] = data.origins.map((origem, indice) => ({
      id: `origem-${indice}`,
      latitude: origem.latitude,
      longitude: origem.longitude,
      tone: 'neutral',
      label: 'Recolha',
      kind: 'origem',
      popup: `<span class="popup__codigo">Ponto de recolha</span><span class="popup__linha">${escapar(
        origem.description,
      )}</span>`,
    }));

    // Drivers last, so a courier is drawn over the parcel he is standing next to.
    return [...origens, ...encomendas, ...motoristas];
  }, [data, visiveis, posicoes]);

  // Only the states that are actually on the map, so the filter cannot offer an
  // option that empties it for no visible reason.
  const estadosPresentes = useMemo(
    () =>
      data === null
        ? []
        : ORDER_STATUSES.filter((status) => data.items.some((ponto) => ponto.status === status)),
    [data],
  );

  return (
    <>
      <PageHeader
        title="Mapa"
        description="Onde estão as encomendas em curso e de onde saem."
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw size={16} />}
            onClick={reload}
            loading={refreshing}
          >
            Actualizar
          </Button>
        }
      />

      {loading ? (
        <Card>
          <LoadingState rows={4} />
        </Card>
      ) : error !== null ? (
        <Card>
          <ErrorState
            title="Não foi possível carregar o mapa."
            message={error.message}
            {...(error.requestId !== undefined ? { requestId: error.requestId } : {})}
            onRetry={reload}
          />
        </Card>
      ) : data === null ? null : (
        <div className="mapa-pagina">
          <Card padded={false}>
            <div className="mapa-barra">
              <div className="mapa-barra__filtro">
                <Select
                  label="Estado"
                  value={estado}
                  onChange={(evento) => setEstado(evento.target.value)}
                >
                  <option value="">Todos os estados em curso</option>
                  {estadosPresentes.map((status) => (
                    <option value={status} key={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </Select>
              </div>

              <p className="mapa-barra__contagem">
                {visiveis.length === 1
                  ? '1 encomenda no mapa'
                  : `${visiveis.length} encomendas no mapa`}
              </p>

              {/* Only what the map can actually show. The map carries open orders,
                  so a green "concluída" entry would name a colour that never
                  appears and leave the reader looking for it. */}
              <ul className="legenda">
                {LEGENDA.map((entrada) => (
                  <li key={entrada.label}>
                    <span
                      className="legenda__cor"
                      data-tone={entrada.tone}
                      data-kind={entrada.kind ?? 'destino'}
                      aria-hidden="true"
                    />
                    {entrada.label}
                  </li>
                ))}
              </ul>
            </div>

            {data.items.length === 0 ? (
              <div className="mapa-pagina__vazio">
                <EmptyState
                  title="Nenhuma encomenda em curso com ponto no mapa."
                  description="As encomendas em curso aparecem aqui assim que tiverem coordenadas."
                />
              </div>
            ) : (
              <LeafletMap
                ariaLabel="Mapa das encomendas em curso"
                marcadores={marcadores}
                centro={data.center}
                onAbrir={(id) => navegar(`/encomendas/${id}`)}
              />
            )}
          </Card>

          {data.withoutCoordinates.length > 0 ? (
            <Card
              padded={false}
              title={`Sem ponto no mapa (${data.withoutCoordinates.length})`}
              actions={
                <span className="mapa-aviso">
                  <MapPinOff size={14} aria-hidden="true" />
                  Abre cada encomenda para marcar o destino
                </span>
              }
            >
              <Table
                caption="Encomendas em curso sem coordenadas"
                columns={COLUNAS}
                rows={data.withoutCoordinates}
                rowKey={(linha) => linha.id}
              />
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
};
