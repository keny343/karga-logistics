import { MapPin, MapPinOff } from 'lucide-react';
import { desdeQuando } from '../utils/format';
import { usePartilhaDePosicao } from './usePartilhaDePosicao';
import './PartilhaDePosicao.css';

/**
 * The driver's own control over being followed.
 *
 * It is a switch he throws, and the card says in plain words what it costs him: it
 * works while this page is open, and it sends a point every ten seconds. On a phone
 * paying for data by the megabyte, that is information he is entitled to before
 * agreeing rather than after noticing.
 */
export const PartilhaDePosicao = () => {
  const { estado, ultimoEnvio, recusa, comecar, parar } = usePartilhaDePosicao();

  const ligada = estado === 'activa' || estado === 'a-pedir-permissao';
  /**
   * "The office can see you" is only true once the server has accepted a point. While
   * the phone is still asking for permission, or has a fix nobody has received yet,
   * the driver is not on anyone's map — and telling him he is would be the one lie in
   * this feature that could get somebody stood up on a roadside.
   */
  const aVer = estado === 'activa' && ultimoEnvio !== null;

  const explicacao = (): string => {
    switch (estado) {
      case 'activa':
        return ultimoEnvio === null
          ? 'Já tenho a tua posição, a enviar para a central.'
          : `Última posição enviada ${desdeQuando(ultimoEnvio.toISOString())}.`;
      case 'a-pedir-permissao':
        return 'Confirma no aviso do telefone para partilhar a localização.';
      case 'sem-permissao':
        // Naming the browser's own setting: "permissão negada" leaves a driver stuck.
        return 'O telefone recusou o acesso à localização. Abre as definições do navegador para este site e permite a localização.';
      case 'sem-suporte':
        return 'Este navegador não sabe dar a localização. Um telefone recente resolve isto.';
      case 'sem-sinal':
        return 'A posição não está a chegar à central. Verifica a ligação à internet.';
      default:
        return 'A central deixa de te ver no mapa enquanto isto estiver desligado.';
    }
  };

  return (
    <section
      className="partilha"
      data-estado={estado}
      data-a-ver={aVer}
      aria-labelledby="partilha-titulo"
    >
      <div className="partilha__cabeca">
        {ligada ? (
          <MapPin size={18} className="partilha__icone" aria-hidden="true" />
        ) : (
          <MapPinOff size={18} className="partilha__icone" aria-hidden="true" />
        )}
        <div>
          <h2 className="partilha__titulo" id="partilha-titulo">
            {aVer
              ? 'A central está a ver-te'
              : ligada
                ? 'A obter a tua posição'
                : 'Partilhar a minha posição'}
          </h2>
          <p className="partilha__estado" role="status">
            {explicacao()}
          </p>
        </div>
        <button
          type="button"
          className={ligada ? 'botao botao--secundario' : 'botao botao--primario'}
          onClick={ligada ? parar : comecar}
        >
          {ligada ? 'Parar' : 'Começar'}
        </button>
      </div>

      {recusa !== null ? (
        <p className="partilha__recusa" role="alert">
          {recusa}
        </p>
      ) : null}

      <p className="partilha__letra-pequena">
        Funciona enquanto esta página estiver aberta e envia um ponto a cada 10
        segundos. Ninguém fora da tua empresa vê onde estás.
      </p>
    </section>
  );
};
