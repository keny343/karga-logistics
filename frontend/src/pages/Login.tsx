import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Package } from 'lucide-react';
import { ApiError } from '../api/client';
import { useSession } from '../auth/SessionContext';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import './Login.css';

/** The demo accounts, so a visitor can get in without reading the README. */
const DEMOS = [
  { papel: 'Administrador', email: 'admin@karga.ao' },
  { papel: 'Operador', email: 'operador@karga.ao' },
  { papel: 'Motorista', email: 'motorista@karga.ao' },
] as const;

const PASSWORD_DEMO = 'Karga2026!';

export const Login = () => {
  const { user, login } = useSession();
  const localizacao = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  if (user !== null) {
    const destino = (localizacao.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={destino} replace />;
  }

  const submeter = async (evento: FormEvent): Promise<void> => {
    evento.preventDefault();
    setErro(null);
    setAEnviar(true);
    try {
      await login(email, password);
    } catch (falha) {
      setErro(
        falha instanceof ApiError ? falha.message : 'Não foi possível iniciar sessão. Tenta de novo.',
      );
    } finally {
      setAEnviar(false);
    }
  };

  const usarDemo = (emailDemo: string): void => {
    setEmail(emailDemo);
    setPassword(PASSWORD_DEMO);
    setErro(null);
  };

  return (
    <main className="entrada">
      <div className="entrada__caixa">
        <div className="entrada__marca">
          <span className="entrada__logo" aria-hidden="true">
            <Package size={20} />
          </span>
          <div>
            <h1>Karga Logistics</h1>
            <p>Gestão de entregas e operações · Luanda</p>
          </div>
        </div>

        <form className="entrada__form" onSubmit={(evento) => void submeter(evento)} noValidate>
          <Input
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(evento) => setEmail(evento.target.value)}
            required
          />
          <Input
            label="Palavra-passe"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(evento) => setPassword(evento.target.value)}
            required
          />

          {/* role=alert so the failure is announced, not only shown. */}
          {erro !== null ? (
            <p className="entrada__erro" role="alert">
              {erro}
            </p>
          ) : null}

          <Button type="submit" variant="primary" loading={aEnviar}>
            Entrar
          </Button>
        </form>

        <div className="entrada__demo">
          <p className="entrada__demo-titulo">Contas de demonstração</p>
          <ul className="entrada__demo-lista">
            {DEMOS.map((demo) => (
              <li key={demo.email}>
                <button type="button" onClick={() => usarDemo(demo.email)}>
                  <strong>{demo.papel}</strong>
                  <span className="mono">{demo.email}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="entrada__demo-nota">
            Palavra-passe <span className="mono">{PASSWORD_DEMO}</span> para todas.
          </p>
        </div>
      </div>
    </main>
  );
};
