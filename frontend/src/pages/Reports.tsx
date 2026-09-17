import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, Download, Package, Percent, XCircle } from 'lucide-react';
import { ApiError, api, type Relatorio } from '../api/client';
import { useResource } from '../hooks/useResource';
import { BarChart, type PontoBarra, type SerieBarra } from '../ui/BarChart';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Distribution } from '../ui/Distribution';
import { Input } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { StatCard } from '../ui/StatCard';
import { Table, type TableColumn } from '../ui/Table';
import { EmptyState, ErrorState, LoadingState } from '../ui/States';
import { useToast } from '../ui/Toast';
import { diaISO, formatDuracao, formatKg, formatKz } from '../utils/format';
import './Reports.css';

const SERIES: readonly SerieBarra[] = [
  { label: 'Criadas', tone: 'primary' },
  { label: 'Entregues', tone: 'success' },
];

/** Presets cover what an operator actually asks for; the inputs cover the rest. */
const PERIODOS = [
  { dias: 6, label: '7 dias' },
  { dias: 29, label: '30 dias' },
  { dias: 89, label: '90 dias' },
] as const;

const recuar = (dias: number): string => diaISO(new Date(Date.now() - dias * 86_400_000));

/**
 * Beyond about six weeks the daily chart becomes a picket fence, so the points are
 * grouped into weeks and the card title says so. The alternative — drawing 90
 * one-pixel bars — is a chart that looks like data without being readable.
 */
const LIMITE_DIARIO = 45;

const agruparPorSemana = (
  pontos: readonly { day: string; created: number; delivered: number }[],
): PontoBarra[] => {
  const semanas: PontoBarra[] = [];

  for (let inicio = 0; inicio < pontos.length; inicio += 7) {
    const bloco = pontos.slice(inicio, inicio + 7);
    const primeiro = bloco[0];
    if (primeiro === undefined) continue;
    semanas.push({
      label: primeiro.day,
      values: [
        bloco.reduce((soma, ponto) => soma + ponto.created, 0),
        bloco.reduce((soma, ponto) => soma + ponto.delivered, 0),
      ],
    });
  }

  return semanas;
};

const COLUNAS_MOTORISTA: readonly TableColumn<Relatorio['byDriver'][number]>[] = [
  { key: 'nome', header: 'Motorista', render: (linha) => linha.driverName },
  { key: 'atribuidas', header: 'Atribuídas', numeric: true, render: (linha) => linha.assigned },
  { key: 'entregues', header: 'Entregues', numeric: true, render: (linha) => linha.delivered },
  {
    key: 'falhas',
    header: 'Falhas',
    numeric: true,
    render: (linha) =>
      linha.failed === 0 ? <span className="tenue">0</span> : <Badge tone="danger">{linha.failed}</Badge>,
  },
  {
    key: 'tempo',
    header: 'Tempo mediano',
    numeric: true,
    secondary: true,
    render: (linha) => formatDuracao(linha.medianDeliveryMinutes),
  },
];

const COLUNAS_ZONA: readonly TableColumn<Relatorio['byMunicipality'][number]>[] = [
  { key: 'municipio', header: 'Município', render: (linha) => linha.municipality },
  { key: 'total', header: 'Encomendas', numeric: true, render: (linha) => linha.count },
  { key: 'entregues', header: 'Entregues', numeric: true, render: (linha) => linha.delivered },
];

export const Reports = () => {
  const [parametros, setParametros] = useSearchParams();
  const toast = useToast();
  const [aExportar, setAExportar] = useState(false);

  // The window lives in the URL, so a report can be sent to somebody as a link.
  const de = parametros.get('de') ?? recuar(29);
  const ate = parametros.get('ate') ?? recuar(0);

  const definir = (mudancas: Record<string, string>) => {
    const proximos = new URLSearchParams(parametros);
    for (const [chave, valor] of Object.entries(mudancas)) proximos.set(chave, valor);
    setParametros(proximos, { replace: true });
  };

  const { data, loading, error, refreshing, reload } = useResource(
    () => api.report({ from: de, to: ate }),
    [de, ate],
  );

  const pontos = useMemo<PontoBarra[]>(() => {
    if (data === null) return [];
    return data.perDay.length > LIMITE_DIARIO
      ? agruparPorSemana(data.perDay)
      : data.perDay.map((ponto) => ({
          label: ponto.day,
          values: [ponto.created, ponto.delivered],
        }));
  }, [data]);

  const porSemana = data !== null && data.perDay.length > LIMITE_DIARIO;

  const exportar = async () => {
    setAExportar(true);
    try {
      await api.exportOrders({ from: de, to: ate });
      toast.sucesso('Exportação gerada. Verifica os teus downloads.');
    } catch (erro) {
      toast.erro(
        erro instanceof ApiError
          ? erro.message
          : 'Não foi possível gerar a exportação. Tenta de novo.',
      );
    } finally {
      setAExportar(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Desempenho da operação num intervalo, com exportação para folha de cálculo."
        actions={
          <Button
            icon={<Download size={16} />}
            onClick={exportar}
            loading={aExportar}
            disabled={error !== null}
          >
            Exportar CSV
          </Button>
        }
      />

      <Card>
        <div className="periodo">
          <div className="periodo__atalhos">
            {PERIODOS.map((periodo) => {
              const activo = de === recuar(periodo.dias) && ate === recuar(0);
              return (
                <Button
                  key={periodo.label}
                  variant={activo ? 'primary' : 'secondary'}
                  onClick={() => definir({ de: recuar(periodo.dias), ate: recuar(0) })}
                >
                  {periodo.label}
                </Button>
              );
            })}
          </div>
          <Input
            label="De"
            type="date"
            value={de}
            max={ate}
            onChange={(evento) => definir({ de: evento.target.value })}
          />
          <Input
            label="Até"
            type="date"
            value={ate}
            min={de}
            max={recuar(0)}
            onChange={(evento) => definir({ ate: evento.target.value })}
          />
        </div>
      </Card>

      {loading ? (
        <Card>
          <LoadingState rows={5} />
        </Card>
      ) : error !== null ? (
        <Card>
          <ErrorState
            title="Não foi possível carregar o relatório."
            message={error.message}
            {...(error.requestId !== undefined ? { requestId: error.requestId } : {})}
            onRetry={reload}
          />
        </Card>
      ) : data === null ? null : (
        <div className="relatorio" data-refreshing={refreshing}>
          <div className="kpis">
            <StatCard
              label="Criadas"
              value={data.totals.created}
              icon={<Package size={16} />}
              tone="info"
            />
            <StatCard
              label="Entregues"
              value={data.totals.delivered}
              icon={<CheckCircle2 size={16} />}
              tone="success"
            />
            <StatCard
              label="Falhas"
              value={data.totals.failed}
              icon={<XCircle size={16} />}
              tone={data.totals.failed > 0 ? 'danger' : 'neutral'}
            />
            <StatCard
              label="Taxa de sucesso"
              // Nothing finished is not zero per cent, and the card must not imply it.
              value={data.totals.successRate === null ? '—' : `${data.totals.successRate}%`}
              hint={
                data.totals.completed === 0
                  ? 'Nada concluído no intervalo'
                  : `Sobre ${data.totals.completed} concluídas`
              }
              icon={<Percent size={16} />}
              tone={
                data.totals.successRate === null
                  ? 'neutral'
                  : data.totals.successRate >= 90
                    ? 'success'
                    : data.totals.successRate >= 70
                      ? 'warning'
                      : 'danger'
              }
            />
            <StatCard
              label="Tempo mediano"
              value={formatDuracao(data.totals.medianDeliveryMinutes)}
              hint="Da criação à entrega"
              icon={<Clock size={16} />}
            />
            <StatCard
              label="Fora do prazo"
              value={data.totals.late}
              hint="Entregues após o prazo"
              icon={<Clock size={16} />}
              tone={data.totals.late > 0 ? 'warning' : 'neutral'}
            />
          </div>

          <div className="painel-duplo">
            <Card title={porSemana ? 'Criadas e entregues por semana' : 'Criadas e entregues por dia'}>
              {data.totals.created === 0 && data.totals.delivered === 0 ? (
                <EmptyState
                  title="Nada aconteceu neste intervalo."
                  description="Escolhe outro período ou confirma as datas."
                />
              ) : (
                <BarChart
                  caption={
                    porSemana
                      ? 'Encomendas criadas e entregues por semana'
                      : 'Encomendas criadas e entregues por dia'
                  }
                  series={SERIES}
                  pontos={pontos}
                />
              )}
            </Card>

            <Card title="Distribuição por estado">
              {data.byStatus.length === 0 ? (
                <EmptyState title="Sem encomendas no intervalo." />
              ) : (
                <Distribution dados={data.byStatus} total={data.totals.created} />
              )}
            </Card>
          </div>

          <div className="painel-duplo">
            <Card title="Desempenho por motorista" padded={false}>
              {data.byDriver.length === 0 ? (
                <EmptyState
                  title="Nenhuma encomenda atribuída no intervalo."
                  description="Motoristas sem entregas neste período não aparecem aqui."
                />
              ) : (
                <Table
                  caption="Desempenho por motorista"
                  columns={COLUNAS_MOTORISTA}
                  rows={data.byDriver}
                  rowKey={(linha) => linha.driverId}
                />
              )}
            </Card>

            <Card title="Destinos" padded={false}>
              {data.byMunicipality.length === 0 ? (
                <EmptyState title="Sem destinos no intervalo." />
              ) : (
                <Table
                  caption="Encomendas por município de destino"
                  columns={COLUNAS_ZONA}
                  rows={data.byMunicipality}
                  rowKey={(linha) => linha.municipality}
                />
              )}
            </Card>
          </div>

          <Card title="Totais do intervalo">
            <dl className="totais">
              <div>
                <dt>Valor declarado</dt>
                <dd>{formatKz(data.totals.valueCents)}</dd>
              </div>
              <div>
                <dt>Peso total</dt>
                <dd>{formatKg(data.totals.weightGrams)}</dd>
              </div>
              <div>
                <dt>Em curso</dt>
                <dd>{data.totals.inProgress}</dd>
              </div>
              <div>
                <dt>Canceladas</dt>
                <dd>{data.totals.cancelled}</dd>
              </div>
              <div>
                <dt>Devolvidas</dt>
                <dd>{data.totals.returned}</dd>
              </div>
            </dl>
          </Card>
        </div>
      )}
    </>
  );
};
