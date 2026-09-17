import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { api, type OrderSummary } from '../api/client';
import { ORDER_STATUSES, statusLabel } from '../domain/orderStatus';
import { useResource } from '../hooks/useResource';
import { useSession } from '../auth/SessionContext';
import { PartilhaDePosicao } from '../realtime/PartilhaDePosicao';
import { useRecarregarCom } from '../realtime/RealtimeContext';
import { Badge, StatusBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { Pagination } from '../ui/Pagination';
import { Table, type TableColumn } from '../ui/Table';
import { EmptyState, ErrorState, LoadingState } from '../ui/States';
import { formatKz, formatQuando } from '../utils/format';
import { NovaEncomendaModal } from './NovaEncomendaModal';
import './Orders.css';

const COLUNAS: readonly TableColumn<OrderSummary>[] = [
  {
    key: 'code',
    header: 'Encomenda',
    // The code is a real link, not just text inside a clickable row: clicking
    // anywhere on the row is a convenience for a mouse, and this is the path a
    // keyboard takes. It also makes "open in a new tab" work, which a dispatcher
    // comparing two orders will want.
    render: (linha) => (
      <div className="celula-codigo">
        <Link className="celula-codigo__link mono" to={`/encomendas/${linha.id}`}>
          {linha.code}
        </Link>
        {linha.late ? <Badge tone="warning">Atrasada</Badge> : null}
      </div>
    ),
  },
  { key: 'cliente', header: 'Cliente', render: (linha) => linha.customerName },
  { key: 'destino', header: 'Destino', secondary: true, render: (linha) => linha.destination },
  {
    key: 'motorista',
    header: 'Motorista',
    secondary: true,
    render: (linha) => linha.driverName ?? <span className="tenue">Sem atribuição</span>,
  },
  { key: 'estado', header: 'Estado', render: (linha) => <StatusBadge status={linha.status} /> },
  {
    key: 'criada',
    header: 'Criada',
    secondary: true,
    render: (linha) => formatQuando(linha.createdAt),
  },
  { key: 'valor', header: 'Valor', numeric: true, render: (linha) => formatKz(linha.valueCents) },
];

export const Orders = () => {
  const navegar = useNavigate();
  const { user } = useSession();
  const [parametros, setParametros] = useSearchParams();
  const [modalAberto, setModalAberto] = useState(false);

  // The URL holds the filters, so a filtered list can be shared or reloaded.
  const estado = parametros.get('status') ?? '';
  const busca = parametros.get('search') ?? '';
  const atrasadas = parametros.get('late') === 'true';
  const pagina = Number(parametros.get('page') ?? '1');

  const actualizar = useCallback(
    (mudancas: Record<string, string>) => {
      const proximos = new URLSearchParams(parametros);
      for (const [chave, valor] of Object.entries(mudancas)) {
        if (valor === '') proximos.delete(chave);
        else proximos.set(chave, valor);
      }
      // Any change to a filter starts again at the first page.
      if (!('page' in mudancas)) proximos.delete('page');
      setParametros(proximos, { replace: true });
    },
    [parametros, setParametros],
  );

  const filtros = useMemo(
    () => ({
      ...(estado !== '' ? { status: estado } : {}),
      ...(busca !== '' ? { search: busca } : {}),
      ...(atrasadas ? { late: 'true' } : {}),
      page: pagina,
    }),
    [estado, busca, atrasadas, pagina],
  );

  const { data, loading, error, refreshing, reload } = useResource(
    () => api.orders(filtros),
    [estado, busca, atrasadas, pagina],
  );

  // The list is the screen a dispatcher leaves open all day, so it keeps itself current.
  useRecarregarCom('encomenda:actualizada', reload);

  const podeCriar = user?.role === 'ADMIN' || user?.role === 'OPERADOR';

  // The API narrows this list by role, so the sentence describing it has to say
  // what the reader is actually looking at.
  const descricao =
    user?.role === 'MOTORISTA'
      ? 'As entregas atribuídas a ti, com o estado actual de cada uma.'
      : user?.role === 'CLIENTE'
        ? 'As tuas encomendas, com o estado actual de cada uma.'
        : 'Todas as encomendas da empresa, com o estado actual de cada uma.';

  return (
    <>
      <PageHeader
        title="Encomendas"
        description={descricao}
        actions={
          podeCriar ? (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setModalAberto(true)}>
              Nova encomenda
            </Button>
          ) : undefined
        }
      />

      {/* The driver's own screen, above his deliveries: this is the one thing on the
          page that is about him rather than about a parcel. */}
      {user?.role === 'MOTORISTA' ? <PartilhaDePosicao /> : null}

      <Card padded={false}>
        <form
          className="filtros"
          onSubmit={(evento) => {
            evento.preventDefault();
            const dados = new FormData(evento.currentTarget);
            actualizar({ search: String(dados.get('search') ?? '') });
          }}
        >
          <div className="filtros__busca">
            <Input
              label="Pesquisar"
              name="search"
              placeholder="Código, cliente ou destino"
              defaultValue={busca}
              key={busca}
            />
          </div>
          <Select
            label="Estado"
            value={estado}
            onChange={(evento) => actualizar({ status: evento.target.value })}
          >
            <option value="">Todos os estados</option>
            {ORDER_STATUSES.map((status) => (
              <option value={status} key={status}>
                {statusLabel(status)}
              </option>
            ))}
          </Select>
          <div className="filtros__accao">
            <Button type="submit" icon={<Search size={16} />}>
              Pesquisar
            </Button>
          </div>
        </form>

        {/* A filter that came from a link on the dashboard has no control of its own
            in this form, so it says so here and offers the way out. Otherwise the
            list looks short for no visible reason. */}
        {atrasadas ? (
          <div className="filtro-activo">
            <Badge tone="warning">Apenas atrasadas</Badge>
            <button type="button" onClick={() => actualizar({ late: '' })}>
              Mostrar todas
            </button>
          </div>
        ) : null}

        {loading ? (
          <LoadingState rows={6} />
        ) : error !== null ? (
          <ErrorState
            title="Não foi possível carregar as encomendas."
            message={error.message}
            {...(error.requestId !== undefined ? { requestId: error.requestId } : {})}
            onRetry={reload}
          />
        ) : data === null || data.items.length === 0 ? (
          <EmptyState
            title="Nenhuma encomenda encontrada."
            description={
              estado !== '' || busca !== ''
                ? 'Nenhuma encomenda corresponde a estes filtros. Tenta limpar a pesquisa.'
                : podeCriar
                  ? 'Cria a primeira encomenda para a operação começar.'
                  : 'Quando houver uma encomenda para ti, aparece aqui.'
            }
            {...(estado !== '' || busca !== ''
              ? {
                  action: (
                    <Button onClick={() => setParametros(new URLSearchParams(), { replace: true })}>
                      Limpar filtros
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <div data-refreshing={refreshing} className="tabela-area">
            <Table
              caption="Lista de encomendas"
              columns={COLUNAS}
              rows={data.items}
              rowKey={(linha) => linha.id}
              onRowClick={(linha) => navegar(`/encomendas/${linha.id}`)}
            />
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={(proxima) => actualizar({ page: String(proxima) })}
            />
          </div>
        )}
      </Card>

      {modalAberto ? (
        <NovaEncomendaModal
          onClose={() => setModalAberto(false)}
          onCreated={(encomenda) => {
            setModalAberto(false);
            navegar(`/encomendas/${encomenda.id}`);
          }}
        />
      ) : null}
    </>
  );
};
