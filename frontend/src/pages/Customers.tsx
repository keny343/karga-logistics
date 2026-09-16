import { useState, type FormEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { ApiError, api, type Customer } from '../api/client';
import { useResource } from '../hooks/useResource';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { PageHeader } from '../ui/PageHeader';
import { Pagination } from '../ui/Pagination';
import { Table, type TableColumn } from '../ui/Table';
import { EmptyState, ErrorState, LoadingState } from '../ui/States';
import { useToast } from '../ui/Toast';
import { formatTelefone } from '../utils/format';

const MUNICIPIOS = [
  'Ingombota',
  'Maianga',
  'Rangel',
  'Samba',
  'Sambizanga',
  'Kilamba Kiaxi',
  'Talatona',
  'Belas',
  'Cacuaco',
  'Cazenga',
  'Viana',
] as const;

const COLUNAS: readonly TableColumn<Customer>[] = [
  { key: 'nome', header: 'Cliente', render: (linha) => linha.name },
  {
    key: 'telefone',
    header: 'Telefone',
    render: (linha) => <span className="mono">{formatTelefone(linha.phone)}</span>,
  },
  { key: 'municipio', header: 'Município', render: (linha) => linha.address.municipality },
  {
    key: 'endereco',
    header: 'Endereço',
    secondary: true,
    render: (linha) => linha.address.description,
  },
  {
    key: 'encomendas',
    header: 'Encomendas',
    numeric: true,
    // A count is context, not identity: on a phone the name, the phone number and
    // the municipality are what the operator needs to see without scrolling.
    secondary: true,
    render: (linha) => linha.ordersCount ?? 0,
  },
];

export const Customers = () => {
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [modalAberto, setModalAberto] = useState(false);

  const { data, loading, error, refreshing, reload } = useResource(
    () => api.customers({ ...(busca !== '' ? { search: busca } : {}), page: pagina }),
    [busca, pagina],
  );

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Quem recebe as encomendas, com o endereço usado por omissão."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setModalAberto(true)}>
            Novo cliente
          </Button>
        }
      />

      <Card padded={false}>
        <form
          className="filtros"
          onSubmit={(evento) => {
            evento.preventDefault();
            const dados = new FormData(evento.currentTarget);
            setBusca(String(dados.get('search') ?? ''));
            setPagina(1);
          }}
        >
          <div className="filtros__busca">
            <Input label="Pesquisar" name="search" placeholder="Nome ou telefone" defaultValue={busca} />
          </div>
          <span />
          <div className="filtros__accao">
            <Button type="submit" icon={<Search size={16} />}>
              Pesquisar
            </Button>
          </div>
        </form>

        {loading ? (
          <LoadingState rows={6} />
        ) : error !== null ? (
          <ErrorState
            title="Não foi possível carregar os clientes."
            message={error.message}
            {...(error.requestId !== undefined ? { requestId: error.requestId } : {})}
            onRetry={reload}
          />
        ) : data === null || data.items.length === 0 ? (
          <EmptyState
            title="Nenhum cliente encontrado."
            description={
              busca !== ''
                ? 'Nenhum cliente corresponde a esta pesquisa.'
                : 'Registra o primeiro cliente para poder criar encomendas.'
            }
          />
        ) : (
          <div className="tabela-area" data-refreshing={refreshing}>
            <Table
              caption="Lista de clientes"
              columns={COLUNAS}
              rows={data.items}
              rowKey={(linha) => linha.id}
            />
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={setPagina}
            />
          </div>
        )}
      </Card>

      {modalAberto ? (
        <NovoClienteModal
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

const NovoClienteModal = ({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: () => void;
}) => {
  const aviso = useToast();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [endereco, setEndereco] = useState('');
  const [municipio, setMunicipio] = useState('Talatona');
  const [referencia, setReferencia] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aEnviar, setAEnviar] = useState(false);

  const submeter = async (evento: FormEvent): Promise<void> => {
    evento.preventDefault();
    const locais: Record<string, string> = {};
    if (nome.trim().length < 2) locais.name = 'Indica o nome do cliente.';
    if (telefone.replace(/\D/g, '').length < 9) locais.phone = 'Número inválido. Nove dígitos.';
    if (endereco.trim().length < 3) locais.address = 'Indica o endereço.';
    setErros(locais);
    if (Object.keys(locais).length > 0) return;

    setAEnviar(true);
    try {
      await api.createCustomer({
        name: nome.trim(),
        phone: telefone.trim(),
        ...(email.trim() !== '' ? { email: email.trim() } : {}),
        address: {
          description: endereco.trim(),
          province: 'Luanda',
          municipality: municipio,
          ...(referencia.trim() !== '' ? { reference: referencia.trim() } : {}),
        },
      });
      aviso.sucesso(`Cliente ${nome.trim()} criado.`);
      onCreated();
    } catch (falha) {
      if (falha instanceof ApiError && falha.details !== undefined) {
        setErros(Object.fromEntries(falha.details.map((d) => [d.field.split('.').pop() ?? d.field, d.message])));
      }
      aviso.erro(falha instanceof ApiError ? falha.message : 'Não foi possível criar o cliente.');
    } finally {
      setAEnviar(false);
    }
  };

  return (
    <Modal
      open
      title="Novo cliente"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={aEnviar}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="form-cliente" loading={aEnviar}>
            Criar cliente
          </Button>
        </>
      }
    >
      <form
        className="form-encomenda"
        id="form-cliente"
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
            placeholder="923 456 789"
            hint="Angola, +244"
            {...(erros.phone !== undefined ? { error: erros.phone } : {})}
          />
          <Input
            label="Email (opcional)"
            type="email"
            value={email}
            onChange={(evento) => setEmail(evento.target.value)}
            {...(erros.email !== undefined ? { error: erros.email } : {})}
          />
        </div>
        <Input
          label="Endereço"
          value={endereco}
          onChange={(evento) => setEndereco(evento.target.value)}
          {...(erros.address !== undefined ? { error: erros.address } : {})}
        />
        <div className="form-encomenda__par">
          <Select
            label="Município"
            value={municipio}
            onChange={(evento) => setMunicipio(evento.target.value)}
          >
            {MUNICIPIOS.map((nomeMunicipio) => (
              <option value={nomeMunicipio} key={nomeMunicipio}>
                {nomeMunicipio}
              </option>
            ))}
          </Select>
          <Input
            label="Ponto de referência"
            value={referencia}
            onChange={(evento) => setReferencia(evento.target.value)}
            hint="Ajuda o motorista a encontrar."
          />
        </div>
      </form>
    </Modal>
  );
};
