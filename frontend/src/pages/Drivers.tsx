import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { ApiError, api, type Driver } from '../api/client';
import { DRIVER_STATUSES, driverStatusLabel, type DriverStatus } from '../domain/orderStatus';
import { useResource } from '../hooks/useResource';
import { DriverStatusBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { PageHeader } from '../ui/PageHeader';
import { Table, type TableColumn } from '../ui/Table';
import { EmptyState, ErrorState, LoadingState } from '../ui/States';
import { useToast } from '../ui/Toast';
import { formatTelefone } from '../utils/format';

const VEICULOS = ['MOTA', 'CARRO', 'CARRINHA'] as const;

const VEICULO_LEGIVEL: Record<string, string> = {
  MOTA: 'Mota',
  CARRO: 'Carro',
  CARRINHA: 'Carrinha',
};

export const Drivers = () => {
  const aviso = useToast();
  const [filtro, setFiltro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [aMudar, setAMudar] = useState<string | null>(null);

  const { data, loading, error, refreshing, reload } = useResource(
    () => api.drivers({ ...(filtro !== '' ? { status: filtro } : {}), page: 1 }),
    [filtro],
  );

  const mudarEstado = async (motorista: Driver, status: DriverStatus): Promise<void> => {
    setAMudar(motorista.id);
    try {
      await api.setDriverStatus(motorista.id, status);
      aviso.sucesso(`${motorista.name} está ${driverStatusLabel(status).toLowerCase()}.`);
      reload();
    } catch (falha) {
      // The API refuses to take a driver off duty mid-delivery and says so.
      aviso.erro(
        falha instanceof ApiError ? falha.message : 'Não foi possível actualizar o motorista.',
      );
    } finally {
      setAMudar(null);
    }
  };

  const colunas: readonly TableColumn<Driver>[] = [
    { key: 'nome', header: 'Motorista', render: (linha) => linha.name },
    {
      key: 'telefone',
      header: 'Telefone',
      render: (linha) => <span className="mono">{formatTelefone(linha.phone)}</span>,
    },
    {
      key: 'veiculo',
      header: 'Veículo',
      secondary: true,
      render: (linha) =>
        linha.vehicleType === undefined ? (
          <span className="tenue">—</span>
        ) : (
          <>
            {VEICULO_LEGIVEL[linha.vehicleType] ?? linha.vehicleType}
            {linha.vehiclePlate !== undefined ? (
              <span className="mono"> · {linha.vehiclePlate}</span>
            ) : null}
          </>
        ),
    },
    { key: 'estado', header: 'Estado', render: (linha) => <DriverStatusBadge status={linha.status} /> },
    { key: 'activas', header: 'Activas', numeric: true, render: (linha) => linha.activeOrders },
    { key: 'entregues', header: 'Entregues', numeric: true, render: (linha) => linha.deliveredCount },
    {
      key: 'accoes',
      header: 'Disponibilidade',
      render: (linha) => (
        <Select
          label={`Disponibilidade de ${linha.name}`}
          labelHidden
          value={linha.status}
          disabled={aMudar === linha.id}
          onChange={(evento) => void mudarEstado(linha, evento.target.value as DriverStatus)}
        >
          {DRIVER_STATUSES.map((status) => (
            <option value={status} key={status}>
              {driverStatusLabel(status)}
            </option>
          ))}
        </Select>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Motoristas"
        description="Quem está em serviço e quantas entregas tem em mão."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setModalAberto(true)}>
            Novo motorista
          </Button>
        }
      />

      <Card padded={false}>
        <div className="filtros">
          <span />
          <Select label="Estado" value={filtro} onChange={(evento) => setFiltro(evento.target.value)}>
            <option value="">Todos</option>
            {DRIVER_STATUSES.map((status) => (
              <option value={status} key={status}>
                {driverStatusLabel(status)}
              </option>
            ))}
          </Select>
          <span />
        </div>

        {loading ? (
          <LoadingState rows={5} />
        ) : error !== null ? (
          <ErrorState
            title="Não foi possível carregar os motoristas."
            message={error.message}
            {...(error.requestId !== undefined ? { requestId: error.requestId } : {})}
            onRetry={reload}
          />
        ) : data === null || data.items.length === 0 ? (
          <EmptyState
            title="Nenhum motorista encontrado."
            description={
              filtro !== ''
                ? 'Nenhum motorista neste estado.'
                : 'Registra os motoristas para poder atribuir entregas.'
            }
          />
        ) : (
          <div className="tabela-area" data-refreshing={refreshing}>
            <Table
              caption="Lista de motoristas"
              columns={colunas}
              rows={data.items}
              rowKey={(linha) => linha.id}
            />
          </div>
        )}
      </Card>

      {modalAberto ? (
        <NovoMotoristaModal
          onClose={() => setModalAberto(false)}
          onCreated={() => {
            setModalAberto(false);
            reload();
          }}
        />
      ) : null}
    </>
  );
};

const NovoMotoristaModal = ({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: () => void;
}) => {
  const aviso = useToast();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [documento, setDocumento] = useState('');
  const [veiculo, setVeiculo] = useState<string>('MOTA');
  const [matricula, setMatricula] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aEnviar, setAEnviar] = useState(false);

  const submeter = async (evento: FormEvent): Promise<void> => {
    evento.preventDefault();
    const locais: Record<string, string> = {};
    if (nome.trim().length < 2) locais.name = 'Indica o nome.';
    if (telefone.replace(/\D/g, '').length < 9) locais.phone = 'Número inválido. Nove dígitos.';
    setErros(locais);
    if (Object.keys(locais).length > 0) return;

    setAEnviar(true);
    try {
      await api.createDriver({
        name: nome.trim(),
        phone: telefone.trim(),
        ...(documento.trim() !== '' ? { documentId: documento.trim() } : {}),
        vehicleType: veiculo,
        ...(matricula.trim() !== '' ? { vehiclePlate: matricula.trim() } : {}),
      });
      aviso.sucesso(`Motorista ${nome.trim()} registado e disponível.`);
      onCreated();
    } catch (falha) {
      aviso.erro(falha instanceof ApiError ? falha.message : 'Não foi possível criar o motorista.');
    } finally {
      setAEnviar(false);
    }
  };

  return (
    <Modal
      open
      title="Novo motorista"
      description="Entra como disponível e pode receber entregas de imediato."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={aEnviar}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="form-motorista" loading={aEnviar}>
            Criar motorista
          </Button>
        </>
      }
    >
      <form
        className="form-encomenda"
        id="form-motorista"
        onSubmit={(evento) => void submeter(evento)}
        noValidate
      >
        <Input
          label="Nome"
          value={nome}
          onChange={(evento) => setNome(evento.target.value)}
          {...(erros.name !== undefined ? { error: erros.name } : {})}
        />
        <div className="form-encomenda__par">
          <Input
            label="Telefone"
            value={telefone}
            onChange={(evento) => setTelefone(evento.target.value)}
            placeholder="924 111 000"
            {...(erros.phone !== undefined ? { error: erros.phone } : {})}
          />
          <Input
            label="Documento (opcional)"
            value={documento}
            onChange={(evento) => setDocumento(evento.target.value)}
          />
        </div>
        <div className="form-encomenda__par">
          <Select label="Veículo" value={veiculo} onChange={(evento) => setVeiculo(evento.target.value)}>
            {VEICULOS.map((tipo) => (
              <option value={tipo} key={tipo}>
                {VEICULO_LEGIVEL[tipo]}
              </option>
            ))}
          </Select>
          <Input
            label="Matrícula"
            value={matricula}
            onChange={(evento) => setMatricula(evento.target.value)}
            placeholder="LD-42-19-MA"
          />
        </div>
      </form>
    </Modal>
  );
};
