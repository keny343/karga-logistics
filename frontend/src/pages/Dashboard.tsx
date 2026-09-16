import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock, Package, Truck, XCircle } from 'lucide-react';
import { api } from '../api/client';
import { statusLabel, statusTone, type OrderStatus } from '../domain/orderStatus';
import { useResource } from '../hooks/useResource';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { StatCard } from '../ui/StatCard';
import { StatusBadge } from '../ui/Badge';
import { Table, type TableColumn } from '../ui/Table';
import { EmptyState, ErrorState, LoadingState } from '../ui/States';
import { formatKz, formatQuando } from '../utils/format';
import type { OrderSummary } from '../api/client';
import './Dashboard.css';

const COLUNAS: readonly TableColumn<OrderSummary>[] = [
  { key: 'code', header: 'Encomenda', render: (linha) => <span className="mono">{linha.code}</span> },
  { key: 'cliente', header: 'Cliente', render: (linha) => linha.customerName },
  {
    key: 'motorista',
    header: 'Motorista',
    secondary: true,
    render: (linha) => linha.driverName ?? <span className="tenue">—</span>,
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

export const Dashboard = () => {
  const navegar = useNavigate();
  const { data, loading, error, reload } = useResource(() => api.dashboard(), []);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Estado da operação de hoje, com as encomendas mais recentes."
      />

      {loading ? (
        <Card>
          <LoadingState rows={5} />
        </Card>
      ) : error !== null ? (
        <Card>
          <ErrorState
            title="Não foi possível carregar o dashboard."
            message={error.message}
            {...(error.requestId !== undefined ? { requestId: error.requestId } : {})}
            onRetry={reload}
          />
        </Card>
      ) : data === null ? null : (
        <>
          <div className="kpis">
            <StatCard
              label="Encomendas hoje"
              value={data.ordersToday}
              icon={<Package size={16} />}
              tone="info"
            />
            <StatCard
              label="Em entrega"
              value={data.inDelivery}
              icon={<Truck size={16} />}
              tone="info"
            />
            <StatCard
              label="Entregues"
              value={data.delivered}
              icon={<CheckCircle2 size={16} />}
              tone="success"
            />
            <StatCard
              label="Em atraso"
              value={data.late}
              hint={data.late > 0 ? 'Fora do prazo previsto' : 'Tudo dentro do prazo'}
              icon={<Clock size={16} />}
              tone={data.late > 0 ? 'warning' : 'neutral'}
            />
            <StatCard
              label="Falhas"
              value={data.failed}
              icon={<XCircle size={16} />}
              tone={data.failed > 0 ? 'danger' : 'neutral'}
            />
            <StatCard
              label="Motoristas em serviço"
              value={data.activeDrivers}
              icon={<Truck size={16} />}
            />
          </div>

          <div className="painel-duplo">
            <Card title="Encomendas por dia" >
              <Grafico dados={data.perDay} />
            </Card>

            <Card title="Distribuição por estado">
              {data.byStatus.length === 0 ? (
                <EmptyState title="Ainda não há encomendas." />
              ) : (
                <Distribuicao dados={data.byStatus} />
              )}
            </Card>
          </div>

          <Card
            title="Actividade recente"
            padded={false}
            actions={<Link to="/encomendas">Ver todas</Link>}
          >
            {data.recent.length === 0 ? (
              <EmptyState
                title="Nenhuma encomenda registada."
                description="As encomendas criadas aparecem aqui, com o estado mais recente."
              />
            ) : (
              <Table
                caption="Encomendas mais recentes"
                columns={COLUNAS}
                rows={data.recent}
                rowKey={(linha) => linha.id}
                onRowClick={(linha) => navegar(`/encomendas/${linha.id}`)}
              />
            )}
          </Card>
        </>
      )}
    </>
  );
};

/**
 * A bar chart in plain CSS. A charting library would add a dependency and a
 * hundred kilobytes to draw fourteen rectangles, and this version reads the same
 * on a slow machine.
 */
const Grafico = ({ dados }: { readonly dados: readonly { day: string; count: number }[] }) => {
  const maximo = Math.max(1, ...dados.map((ponto) => ponto.count));

  return (
    <div className="grafico">
      {dados.map((ponto) => {
        const dia = new Date(`${ponto.day}T00:00:00`);
        const etiqueta = dia.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
        return (
          <div className="grafico__coluna" key={ponto.day}>
            <div
              className="grafico__barra"
              style={{ height: `${Math.max(2, (ponto.count / maximo) * 100)}%` }}
              // The bar is decorative; the number and date live in the label below.
              aria-hidden="true"
            />
            <span className="grafico__valor">{ponto.count}</span>
            <span className="grafico__dia">{etiqueta}</span>
          </div>
        );
      })}
    </div>
  );
};

const Distribuicao = ({
  dados,
}: {
  readonly dados: readonly { status: OrderStatus; count: number }[];
}) => {
  const total = dados.reduce((soma, item) => soma + item.count, 0);
  const ordenado = [...dados].sort((a, b) => b.count - a.count);

  return (
    <ul className="distribuicao">
      {ordenado.map((item) => (
        <li className="distribuicao__linha" key={item.status}>
          <span className="distribuicao__rotulo">{statusLabel(item.status)}</span>
          <span className="distribuicao__barra" aria-hidden="true">
            <span
              data-tone={statusTone(item.status)}
              style={{ width: `${total === 0 ? 0 : (item.count / total) * 100}%` }}
            />
          </span>
          <span className="distribuicao__valor">{item.count}</span>
        </li>
      ))}
    </ul>
  );
};
