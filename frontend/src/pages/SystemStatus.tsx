import { useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import type { Tone } from '../domain/orderStatus';
import './SystemStatus.css';

interface Health {
  readonly status: string;
  readonly service: string;
  readonly uptimeSeconds: number;
}

type Estado =
  | { fase: 'a-verificar' }
  | { fase: 'ok'; health: Health; verificadoEm: Date }
  | { fase: 'falha'; mensagem: string; verificadoEm: Date; requestId?: string };

const TOM: Record<Estado['fase'], Tone> = {
  'a-verificar': 'neutral',
  ok: 'success',
  falha: 'danger',
};

const ROTULO: Record<Estado['fase'], string> = {
  'a-verificar': 'A verificar',
  ok: 'API operacional',
  falha: 'API inacessível',
};

const hora = (data: Date): string =>
  data.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * A diagnostics page, reachable at /estado without signing in. It exists so that
 * "the app is broken" can be answered with "the API answers, in this many seconds
 * of uptime" or with the request id of the failure.
 */
export const SystemStatus = () => {
  const [estado, setEstado] = useState<Estado>({ fase: 'a-verificar' });

  useEffect(() => {
    let activo = true;
    api
      .health()
      .then((health) => {
        if (activo) setEstado({ fase: 'ok', health, verificadoEm: new Date() });
      })
      .catch((erro: unknown) => {
        if (!activo) return;
        const apiErro = erro instanceof ApiError ? erro : null;
        setEstado({
          fase: 'falha',
          mensagem: apiErro?.message ?? 'Erro inesperado.',
          verificadoEm: new Date(),
          ...(apiErro?.requestId !== undefined ? { requestId: apiErro.requestId } : {}),
        });
      });
    return () => {
      activo = false;
    };
  }, []);

  return (
    <main className="estado-sistema">
      <PageHeader
        title="Estado do sistema"
        description="Karga Logistics — operações de entrega de última milha, Luanda."
        actions={<Badge tone={TOM[estado.fase]}>{ROTULO[estado.fase]}</Badge>}
      />

      <Card title="API">
        <dl className="dados">
          <div>
            <dt>Serviço</dt>
            <dd className="mono">
              {estado.fase === 'ok'
                ? `${estado.health.service} · ${estado.health.uptimeSeconds}s de uptime`
                : '—'}
            </dd>
          </div>
          {estado.fase === 'falha' ? (
            <div>
              <dt>Motivo</dt>
              <dd className="estado-sistema__erro">
                {estado.mensagem}
                {estado.requestId !== undefined ? (
                  <span className="mono"> ({estado.requestId})</span>
                ) : null}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Verificado</dt>
            <dd className="mono">
              {estado.fase === 'a-verificar' ? '—' : hora(estado.verificadoEm)}
            </dd>
          </div>
        </dl>
      </Card>
    </main>
  );
};
