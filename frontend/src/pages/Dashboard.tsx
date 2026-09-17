import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock, Package, Truck, XCircle } from 'lucide-react';
import { api } from '../api/client';
import { useResource } from '../hooks/useResource';
import { useRecarregarCom } from '../realtime/RealtimeContext';
import { BarChart, type SerieBarra } from '../ui/BarChart';
import { Card } from '../ui/Card';
import { Distribution } from '../ui/Distribution';
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

const SERIE_CRIADAS: readonly SerieBarra[] = [{ label: 'Criadas', tone: 'primary' }];

export const Dashboard = () => {
  const navegar = useNavigate();
  const { data, loading, error, reload } = useResource(() => api.dashboard(), []);

  // This is the screen left open on the wall. Counters that quietly stop counting are
  // worse than no counters: the operation looks calm because nobody is being told.
  useRecarregarCom('encomenda:actualizada', reload);

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
              to="/encomendas"
            />
            <StatCard
              label="Em entrega"
              value={data.inDelivery}
              icon={<Truck size={16} />}
              tone="info"
              to="/encomendas?status=EM_ENTREGA"
            />
            <StatCard
              label="Entregues"
              value={data.delivered}
              icon={<CheckCircle2 size={16} />}
              tone="success"
              to="/encomendas?status=ENTREGUE"
            />
            <StatCard
              label="Em atraso"
              value={data.late}
              hint={data.late > 0 ? 'Fora do prazo previsto' : 'Tudo dentro do prazo'}
              icon={<Clock size={16} />}
              tone={data.late > 0 ? 'warning' : 'neutral'}
              to="/encomendas?late=true"
            />
            <StatCard
              label="Falhas"
              value={data.failed}
              icon={<XCircle size={16} />}
              tone={data.failed > 0 ? 'danger' : 'neutral'}
              to="/encomendas?status=FALHA_ENTREGA"
            />
            <StatCard
              label="Motoristas em serviço"
              value={data.activeDrivers}
              icon={<Truck size={16} />}
              to="/motoristas"
            />
          </div>

          <div className="painel-duplo">
            <Card title="Encomendas por dia">
              <BarChart
                caption="Encomendas criadas por dia, nos últimos catorze dias"
                series={SERIE_CRIADAS}
                pontos={data.perDay.map((ponto) => ({ label: ponto.day, values: [ponto.count] }))}
              />
            </Card>

            <Card title="Distribuição por estado">
              {data.byStatus.length === 0 ? (
                <EmptyState title="Ainda não há encomendas." />
              ) : (
                <Distribution dados={data.byStatus} />
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

