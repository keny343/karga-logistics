import { useEffect, useState } from 'react';
import { ApiError, api, type Health } from '../api/client';
import { StatusPill, type StatusGroup } from '../components/StatusPill';
import './SystemStatus.css';

type Estado =
  | { fase: 'a-verificar' }
  | { fase: 'ok'; health: Health; verificadoEm: Date }
  | { fase: 'falha'; mensagem: string; verificadoEm: Date; requestId?: string };

const grupo = (estado: Estado): StatusGroup => {
  if (estado.fase === 'ok') return 'done';
  if (estado.fase === 'falha') return 'failed';
  return 'pending';
};

const rotulo = (estado: Estado): string => {
  if (estado.fase === 'ok') return 'API operacional';
  if (estado.fase === 'falha') return 'API inacessível';
  return 'A verificar';
};

const hora = (data: Date): string =>
  data.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Phase 1 has no business screens yet, so the entry point shows the one thing
 * that is real: whether this build can reach its API. It doubles as the first
 * piece of the operational identity - dense, monospaced, no marketing.
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
    <main className="status">
      <header className="status__header">
        <div>
          <h1>Karga Logistics</h1>
          <p className="status__sub">Operações de entrega de última milha — Luanda, Angola</p>
        </div>
        <StatusPill label={rotulo(estado)} group={grupo(estado)} />
      </header>

      <section className="panel" aria-labelledby="fundacao">
        <h2 id="fundacao" className="panel__title">
          Fundação
        </h2>
        <dl className="kv">
          <div className="kv__row">
            <dt>Serviço</dt>
            <dd className="mono">
              {estado.fase === 'ok'
                ? `${estado.health.service} · ${estado.health.uptimeSeconds}s de uptime`
                : '—'}
            </dd>
          </div>
          {estado.fase === 'falha' ? (
            <div className="kv__row">
              <dt>Motivo</dt>
              <dd className="status__erro">
                {estado.mensagem}
                {estado.requestId !== undefined ? (
                  <>
                    {' '}
                    <span className="mono status__rid">({estado.requestId})</span>
                  </>
                ) : null}
              </dd>
            </div>
          ) : null}
          <div className="kv__row">
            <dt>Verificado</dt>
            <dd className="mono">
              {estado.fase === 'a-verificar' ? '—' : hora(estado.verificadoEm)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="proximo">
        <h2 id="proximo" className="panel__title">
          A construir
        </h2>
        <p className="panel__texto">
          Autenticação com isolamento por empresa, encomendas com máquina de estados, atribuição a
          motoristas, mapa operacional, localização em tempo real e prova de entrega. Cada fase entra
          com testes.
        </p>
      </section>
    </main>
  );
};
