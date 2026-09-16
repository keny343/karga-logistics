import { useState, type FormEvent } from 'react';
import { ApiError, api, type Order } from '../api/client';
import { useResource } from '../hooks/useResource';
import { Button } from '../ui/Button';
import { Input, Select, Textarea } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { ErrorState, LoadingState } from '../ui/States';
import './NovaEncomendaModal.css';

interface Props {
  readonly onClose: () => void;
  readonly onCreated: (encomenda: Order) => void;
}

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
  'Icolo e Bengo',
  'Quiçama',
] as const;

const ORIGEM_PADRAO = {
  description: 'Armazém Karga, Estrada de Cacuaco km 8, pavilhão B',
  municipality: 'Cacuaco',
};

/**
 * The destination is prefilled from the chosen customer, because in practice a
 * parcel goes to the address on file; the operator can still change it, and what
 * they submit is frozen on the order.
 */
export const NovaEncomendaModal = ({ onClose, onCreated }: Props) => {
  const aviso = useToast();
  const clientes = useResource(() => api.customers({ page: 1 }), []);

  const [clienteId, setClienteId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [peso, setPeso] = useState('');
  const [valor, setValor] = useState('');
  const [destino, setDestino] = useState('');
  const [municipio, setMunicipio] = useState('Talatona');
  const [prazo, setPrazo] = useState('');
  const [notas, setNotas] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aEnviar, setAEnviar] = useState(false);

  const escolherCliente = (id: string): void => {
    setClienteId(id);
    const cliente = clientes.data?.items.find((item) => item.id === id);
    if (cliente !== undefined) {
      setDestino(cliente.address.description);
      setMunicipio(cliente.address.municipality);
    }
  };

  const submeter = async (evento: FormEvent): Promise<void> => {
    evento.preventDefault();
    setErros({});

    const locais: Record<string, string> = {};
    if (clienteId === '') locais.customerId = 'Escolhe o cliente.';
    if (descricao.trim().length < 3) locais.description = 'Descreve o que vai ser transportado.';
    if (destino.trim().length < 3) locais.destination = 'Indica o endereço de entrega.';
    const pesoKg = Number(peso);
    if (peso === '' || Number.isNaN(pesoKg) || pesoKg < 0) locais.weight = 'Peso inválido.';
    const valorKz = Number(valor);
    if (valor === '' || Number.isNaN(valorKz) || valorKz < 0) locais.value = 'Valor inválido.';
    if (Object.keys(locais).length > 0) {
      setErros(locais);
      return;
    }

    setAEnviar(true);
    try {
      const { order } = await api.createOrder({
        customerId: clienteId,
        description: descricao.trim(),
        // The form speaks kilograms and Kwanzas; the API only ever sees integers.
        weightGrams: Math.round(pesoKg * 1000),
        valueCents: Math.round(valorKz * 100),
        origin: { ...ORIGEM_PADRAO, province: 'Luanda' },
        destination: { description: destino.trim(), municipality: municipio, province: 'Luanda' },
        ...(prazo !== '' ? { expectedAt: new Date(prazo).toISOString() } : {}),
        ...(notas.trim() !== '' ? { notes: notas.trim() } : {}),
      });
      aviso.sucesso(`Encomenda ${order.code} criada.`);
      onCreated(order);
    } catch (falha) {
      if (falha instanceof ApiError && falha.details !== undefined) {
        setErros(
          Object.fromEntries(falha.details.map((detalhe) => [detalhe.field, detalhe.message])),
        );
        aviso.erro(falha.message);
      } else {
        aviso.erro(
          falha instanceof ApiError ? falha.message : 'Não foi possível criar a encomenda.',
        );
      }
    } finally {
      setAEnviar(false);
    }
  };

  return (
    <Modal
      open
      title="Nova encomenda"
      description="A encomenda entra no estado Criado e segue para confirmação."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={aEnviar}>
            Cancelar
          </Button>
          <Button variant="primary" form="form-encomenda" type="submit" loading={aEnviar}>
            Criar encomenda
          </Button>
        </>
      }
    >
      {clientes.loading ? (
        <LoadingState rows={4} />
      ) : clientes.error !== null ? (
        <ErrorState
          title="Não foi possível carregar os clientes."
          message={clientes.error.message}
          onRetry={clientes.reload}
        />
      ) : (
        <form className="form-encomenda" id="form-encomenda" onSubmit={(evento) => void submeter(evento)} noValidate>
          <Select
            label="Cliente"
            value={clienteId}
            onChange={(evento) => escolherCliente(evento.target.value)}
            {...(erros.customerId !== undefined ? { error: erros.customerId } : {})}
          >
            <option value="">Escolhe o cliente</option>
            {clientes.data?.items.map((cliente) => (
              <option value={cliente.id} key={cliente.id}>
                {cliente.name} — {cliente.address.municipality}
              </option>
            ))}
          </Select>

          <Input
            label="Conteúdo"
            value={descricao}
            onChange={(evento) => setDescricao(evento.target.value)}
            {...(erros.description !== undefined ? { error: erros.description } : {})}
          />

          <div className="form-encomenda__par">
            <Input
              label="Peso (kg)"
              type="number"
              step="0.1"
              min="0"
              value={peso}
              onChange={(evento) => setPeso(evento.target.value)}
              {...(erros.weight !== undefined ? { error: erros.weight } : {})}
            />
            <Input
              label="Valor declarado (Kz)"
              type="number"
              step="0.01"
              min="0"
              value={valor}
              onChange={(evento) => setValor(evento.target.value)}
              {...(erros.value !== undefined ? { error: erros.value } : {})}
            />
          </div>

          <Input
            label="Endereço de entrega"
            value={destino}
            onChange={(evento) => setDestino(evento.target.value)}
            hint="Preenchido a partir do cliente. Podes ajustar."
            {...(erros.destination !== undefined ? { error: erros.destination } : {})}
          />

          <div className="form-encomenda__par">
            <Select
              label="Município"
              value={municipio}
              onChange={(evento) => setMunicipio(evento.target.value)}
            >
              {MUNICIPIOS.map((nome) => (
                <option value={nome} key={nome}>
                  {nome}
                </option>
              ))}
            </Select>
            <Input
              label="Prazo previsto"
              type="datetime-local"
              value={prazo}
              onChange={(evento) => setPrazo(evento.target.value)}
            />
          </div>

          <Textarea
            label="Observações"
            value={notas}
            onChange={(evento) => setNotas(evento.target.value)}
            rows={2}
          />
        </form>
      )}
    </Modal>
  );
};
