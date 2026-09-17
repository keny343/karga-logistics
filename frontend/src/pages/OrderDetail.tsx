import { Suspense, lazy, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Package, Truck, User } from 'lucide-react';
import { ApiError, api, type Driver, type Order } from '../api/client';
import {
  ESTADOS_FINAIS,
  TIMELINE_PRINCIPAL,
  statusLabel,
  type OrderStatus,
} from '../domain/orderStatus';
import { useResource } from '../hooks/useResource';
import { useSession } from '../auth/SessionContext';
import { Badge, StatusBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Select, Textarea } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { PageHeader } from '../ui/PageHeader';
import { Timeline, type TimelinePasso } from '../ui/Timeline';
import { ErrorState, LoadingState } from '../ui/States';
import { useToast } from '../ui/Toast';
import { formatDateTime, formatKg, formatKz, formatTelefone } from '../utils/format';
import './OrderDetail.css';

/** Same reason as the map screen: Leaflet arrives only when a map is on screen. */
const DestinoNoMapa = lazy(() =>
  import('./DestinoNoMapa').then((modulo) => ({ default: modulo.DestinoNoMapa })),
);

/**
 * The timeline shows the standard path with the steps already taken marked, and
 * then any exception the order actually went through. An order that failed and was
 * returned must not look like it is still on its way.
 */
const construirTimeline = (encomenda: Order): readonly TimelinePasso[] => {
  const porEstado = new Map(encomenda.history.map((entrada) => [entrada.status, entrada]));
  const indiceActual = TIMELINE_PRINCIPAL.indexOf(encomenda.status);

  const principais = TIMELINE_PRINCIPAL.map((status, indice): TimelinePasso => {
    const registo = porEstado.get(status);
    const estado: TimelinePasso['state'] =
      status === encomenda.status
        ? 'current'
        : registo !== undefined
          ? 'done'
          : indiceActual === -1 && registo === undefined
            ? 'pending'
            : indice < indiceActual
              ? 'done'
              : 'pending';

    return {
      label: statusLabel(status),
      state: estado,
      ...(registo !== undefined ? { at: formatDateTime(registo.at), by: registo.by } : {}),
      ...(registo?.note !== undefined ? { note: registo.note } : {}),
    };
  });

  // Cancellations, failures and returns are not part of the standard path, so they
  // are appended in the order they happened.
  const excepcoes = encomenda.history
    .filter((entrada) => !TIMELINE_PRINCIPAL.includes(entrada.status))
    .map(
      (entrada): TimelinePasso => ({
        label: statusLabel(entrada.status),
        at: formatDateTime(entrada.at),
        by: entrada.by,
        state: entrada.status === encomenda.status ? 'failed' : 'done',
        ...(entrada.note !== undefined ? { note: entrada.note } : {}),
      }),
    );

  return [...principais, ...excepcoes];
};

const VARIANTE: Partial<Record<OrderStatus, 'primary' | 'success' | 'danger' | 'secondary'>> = {
  ENTREGUE: 'success',
  FALHA_ENTREGA: 'danger',
  CANCELADO: 'danger',
  DEVOLVIDO: 'secondary',
};

/** Reasons are required for the states that need explaining later. */
const EXIGE_NOTA: readonly OrderStatus[] = ['FALHA_ENTREGA', 'CANCELADO', 'DEVOLVIDO'];

export const OrderDetail = () => {
  const { id = '' } = useParams();
  const aviso = useToast();
  const { user } = useSession();
  const { data, loading, error, reload } = useResource(() => api.order(id), [id]);

  const [aMudar, setAMudar] = useState<OrderStatus | null>(null);
  const [nota, setNota] = useState('');
  const [aGuardar, setAGuardar] = useState(false);
  const [modalAtribuir, setModalAtribuir] = useState(false);

  const encomenda = data?.order ?? null;
  const podeOperar = user?.role === 'ADMIN' || user?.role === 'OPERADOR';
  const podeMudar = podeOperar || user?.role === 'MOTORISTA';

  const mudarEstado = async (status: OrderStatus, comNota: string): Promise<void> => {
    setAGuardar(true);
    try {
      await api.changeStatus(id, status, comNota);
      aviso.sucesso(`Encomenda actualizada para ${statusLabel(status)}.`);
      setAMudar(null);
      setNota('');
      reload();
    } catch (falha) {
      aviso.erro(
        falha instanceof ApiError
          ? falha.message
          : 'Não foi possível actualizar a encomenda. Tenta de novo.',
      );
    } finally {
      setAGuardar(false);
    }
  };

  const pedirMudanca = (status: OrderStatus): void => {
    if (EXIGE_NOTA.includes(status)) {
      setAMudar(status);
      return;
    }
    void mudarEstado(status, '');
  };

  if (loading) {
    return (
      <Card>
        <LoadingState rows={6} />
      </Card>
    );
  }

  if (error !== null || encomenda === null) {
    return (
      <Card>
        <ErrorState
          title={
            error?.status === 404
              ? 'Esta encomenda não existe ou não pertence à tua empresa.'
              : 'Não foi possível carregar a encomenda.'
          }
          message={error?.message ?? 'Erro inesperado.'}
          {...(error?.requestId !== undefined ? { requestId: error.requestId } : {})}
          onRetry={reload}
        />
      </Card>
    );
  }

  const precisaMotorista = encomenda.allowedTransitions.length === 0 && encomenda.status === 'PRONTO';

  return (
    <>
      <div className="detalhe__voltar">
        <Link to="/encomendas">
          <ArrowLeft size={16} aria-hidden="true" /> Encomendas
        </Link>
      </div>

      <PageHeader
        title={encomenda.code}
        description={encomenda.description}
        actions={
          <div className="detalhe__acoes">
            <StatusBadge status={encomenda.status} />
            {encomenda.late ? <Badge tone="warning">Atrasada</Badge> : null}
            {podeOperar && encomenda.status === 'PRONTO' ? (
              <Button variant="primary" icon={<Truck size={16} />} onClick={() => setModalAtribuir(true)}>
                Atribuir motorista
              </Button>
            ) : null}
            {podeMudar
              ? encomenda.allowedTransitions
                  .filter((status) => status !== 'ATRIBUIDO')
                  .map((status) => (
                    <Button
                      key={status}
                      variant={VARIANTE[status] ?? 'secondary'}
                      loading={aGuardar && aMudar === null}
                      onClick={() => pedirMudanca(status)}
                    >
                      {statusLabel(status)}
                    </Button>
                  ))
              : null}
          </div>
        }
      />

      {precisaMotorista ? (
        <p className="detalhe__aviso">
          Esta encomenda está pronta e só avança depois de ter um motorista atribuído.
        </p>
      ) : null}

      <div className="detalhe">
        <div className="detalhe__coluna">
          <Card title="Percurso">
            <Timeline steps={construirTimeline(encomenda)} />
          </Card>

          <Suspense fallback={null}>
            <DestinoNoMapa
              encomenda={encomenda}
              // A finished order's destination is history: the API refuses to move
              // it, so the interface does not offer to.
              podeEditar={podeOperar && !ESTADOS_FINAIS.includes(encomenda.status)}
              onGuardado={reload}
            />
          </Suspense>
        </div>

        <div className="detalhe__coluna">
          <Card title="Cliente">
            <dl className="dados">
              <div>
                <dt>
                  <User size={14} aria-hidden="true" /> Nome
                </dt>
                <dd>{encomenda.customerName}</dd>
              </div>
              <div>
                <dt>
                  <MapPin size={14} aria-hidden="true" /> Entrega
                </dt>
                <dd>
                  {encomenda.destinationAddress.description}
                  <br />
                  <span className="tenue">
                    {encomenda.destinationAddress.municipality},{' '}
                    {encomenda.destinationAddress.province}
                  </span>
                  {encomenda.destinationAddress.reference !== undefined ? (
                    <>
                      <br />
                      <span className="tenue">{encomenda.destinationAddress.reference}</span>
                    </>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>
                  <Package size={14} aria-hidden="true" /> Recolha
                </dt>
                <dd>
                  {encomenda.origin.description}
                  <br />
                  <span className="tenue">{encomenda.origin.municipality}</span>
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Encomenda">
            <dl className="dados">
              <div>
                <dt>Motorista</dt>
                <dd>{encomenda.driverName ?? <span className="tenue">Sem atribuição</span>}</dd>
              </div>
              <div>
                <dt>Peso</dt>
                <dd>{formatKg(encomenda.weightGrams)}</dd>
              </div>
              <div>
                <dt>Valor declarado</dt>
                <dd>{formatKz(encomenda.valueCents)}</dd>
              </div>
              <div>
                <dt>Criada</dt>
                <dd>{formatDateTime(encomenda.createdAt)}</dd>
              </div>
              {encomenda.expectedAt !== undefined ? (
                <div>
                  <dt>Prazo previsto</dt>
                  <dd className={encomenda.late ? 'detalhe__atraso' : undefined}>
                    {formatDateTime(encomenda.expectedAt)}
                  </dd>
                </div>
              ) : null}
              {encomenda.completedAt !== undefined ? (
                <div>
                  <dt>Concluída</dt>
                  <dd>{formatDateTime(encomenda.completedAt)}</dd>
                </div>
              ) : null}
              {encomenda.notes !== undefined ? (
                <div>
                  <dt>Observações</dt>
                  <dd>{encomenda.notes}</dd>
                </div>
              ) : null}
            </dl>
          </Card>
        </div>
      </div>

      <Modal
        open={aMudar !== null}
        title={aMudar !== null ? `Marcar como ${statusLabel(aMudar)}` : ''}
        description="Explica o motivo. Fica registado no histórico da encomenda."
        onClose={() => {
          setAMudar(null);
          setNota('');
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setAMudar(null);
                setNota('');
              }}
              disabled={aGuardar}
            >
              Cancelar
            </Button>
            <Button
              variant={aMudar !== null ? (VARIANTE[aMudar] ?? 'primary') : 'primary'}
              loading={aGuardar}
              disabled={nota.trim().length < 3}
              onClick={() => {
                if (aMudar !== null) void mudarEstado(aMudar, nota.trim());
              }}
            >
              Confirmar
            </Button>
          </>
        }
      >
        <Textarea
          label="Motivo"
          value={nota}
          onChange={(evento) => setNota(evento.target.value)}
          hint="Por exemplo: ninguém no local, cliente pediu nova tentativa amanhã."
        />
      </Modal>

      {modalAtribuir ? (
        <AtribuirMotoristaModal
          orderId={id}
          onClose={() => setModalAtribuir(false)}
          onAssigned={() => {
            setModalAtribuir(false);
            reload();
          }}
        />
      ) : null}
    </>
  );
};

const AtribuirMotoristaModal = ({
  orderId,
  onClose,
  onAssigned,
}: {
  readonly orderId: string;
  readonly onClose: () => void;
  readonly onAssigned: () => void;
}) => {
  const aviso = useToast();
  const { data, loading, error, reload } = useResource(
    () => api.drivers({ status: 'DISPONIVEL' }),
    [],
  );
  const [escolhido, setEscolhido] = useState('');
  const [aGuardar, setAGuardar] = useState(false);

  const disponiveis: readonly Driver[] = data?.items ?? [];

  const atribuir = async (): Promise<void> => {
    setAGuardar(true);
    try {
      const { order } = await api.assignOrder(orderId, escolhido);
      aviso.sucesso(`${order.driverName ?? 'Motorista'} atribuído a ${order.code}.`);
      onAssigned();
    } catch (falha) {
      // The API explains why - already carrying a parcel, off duty - and that
      // explanation is what the operator needs to see.
      aviso.erro(
        falha instanceof ApiError ? falha.message : 'Não foi possível atribuir o motorista.',
      );
    } finally {
      setAGuardar(false);
    }
  };

  return (
    <Modal
      open
      title="Atribuir motorista"
      description="Só aparecem motoristas disponíveis, sem entrega activa."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={aGuardar}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={aGuardar}
            disabled={escolhido === ''}
            onClick={() => void atribuir()}
          >
            Atribuir
          </Button>
        </>
      }
    >
      {loading ? (
        <LoadingState rows={3} />
      ) : error !== null ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : disponiveis.length === 0 ? (
        <p className="tenue">
          Nenhum motorista disponível neste momento. Um motorista fica disponível quando termina a
          entrega actual.
        </p>
      ) : (
        <Select
          label="Motorista"
          value={escolhido}
          onChange={(evento) => setEscolhido(evento.target.value)}
        >
          <option value="">Escolhe o motorista</option>
          {disponiveis.map((motorista) => (
            <option value={motorista.id} key={motorista.id}>
              {motorista.name} · {formatTelefone(motorista.phone)}
              {motorista.vehiclePlate !== undefined ? ` · ${motorista.vehiclePlate}` : ''}
            </option>
          ))}
        </Select>
      )}
    </Modal>
  );
};
