import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, Package, X } from 'lucide-react';
import { useSession } from '../auth/SessionContext';
import { IndicadorLigacao } from '../realtime/IndicadorLigacao';
import { useAvisosTempoReal } from '../realtime/useAvisos';
import { iniciais } from '../utils/format';
import { gruposPara } from './navigation';
import './AppLayout.css';

const PAPEL_LEGIVEL: Record<string, string> = {
  ADMIN: 'Administrador',
  OPERADOR: 'Operador',
  MOTORISTA: 'Motorista',
  CLIENTE: 'Cliente',
};

export const AppLayout = () => {
  const { user, logout } = useSession();
  const localizacao = useLocation();
  const [drawerAberto, setDrawerAberto] = useState(false);

  // Mounted once, here: a driver handed a delivery must hear about it wherever he is
  // in the application.
  useAvisosTempoReal();

  // Navigating on a phone must close the drawer, otherwise the new page arrives
  // hidden behind it.
  useEffect(() => {
    setDrawerAberto(false);
  }, [localizacao.pathname]);

  if (user === null) return null;

  const grupos = gruposPara(user.role);

  return (
    <div className="app">
      <a className="app__salto" href="#conteudo">
        Saltar para o conteúdo
      </a>

      {drawerAberto ? (
        <div className="app__cortina" onClick={() => setDrawerAberto(false)} aria-hidden="true" />
      ) : null}

      <aside className="barra" data-aberta={drawerAberto} aria-label="Navegação principal">
        <div className="barra__marca">
          <Link to="/" className="barra__logo">
            <Package size={18} aria-hidden="true" />
            <span>Karga</span>
          </Link>
          <button
            type="button"
            className="barra__fechar"
            onClick={() => setDrawerAberto(false)}
            aria-label="Fechar navegação"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="barra__nav">
          {grupos.map((grupo) => (
            <div className="barra__grupo" key={grupo.title}>
              <p className="barra__grupo-titulo">{grupo.title}</p>
              {grupo.items.map((item) => {
                const Icone = item.icon;
                if (item.pending === true) {
                  return (
                    <span
                      className="barra__item"
                      data-pendente="true"
                      key={item.to}
                      title="Disponível numa fase seguinte"
                    >
                      <Icone size={16} aria-hidden="true" />
                      {item.label}
                      <span className="barra__breve">breve</span>
                    </span>
                  );
                }
                return (
                  <NavLink
                    className="barra__item"
                    to={item.to}
                    key={item.to}
                    end={item.to === '/'}
                  >
                    <Icone size={16} aria-hidden="true" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="barra__pe">
          <div className="barra__perfil">
            <span className="barra__avatar" aria-hidden="true">
              {iniciais(user.name)}
            </span>
            <span className="barra__perfil-texto">
              <strong>{user.name}</strong>
              <small>{PAPEL_LEGIVEL[user.role] ?? user.role}</small>
            </span>
          </div>
          <button type="button" className="barra__sair" onClick={() => void logout()}>
            <LogOut size={16} aria-hidden="true" />
            Sair
          </button>
        </div>
      </aside>

      <div className="app__coluna">
        <header className="topo">
          <button
            type="button"
            className="topo__menu"
            onClick={() => setDrawerAberto(true)}
            aria-label="Abrir navegação"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="topo__contexto">
            <strong>{user.companyName}</strong>
            <span>Luanda, Angola</span>
          </div>
          <IndicadorLigacao />
          <span className="topo__avatar" title={user.email}>
            {iniciais(user.name)}
          </span>
        </header>

        <main className="app__conteudo" id="conteudo">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
