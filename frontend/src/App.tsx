import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './auth/SessionContext';
import { AppLayout } from './layout/AppLayout';
import { Customers } from './pages/Customers';
import { Dashboard } from './pages/Dashboard';
import { Drivers } from './pages/Drivers';
import { Login } from './pages/Login';
import { OrderDetail } from './pages/OrderDetail';
import { Orders } from './pages/Orders';
import { Reports } from './pages/Reports';
import { SystemStatus } from './pages/SystemStatus';
import { ToastProvider } from './ui/Toast';
import { LoadingState } from './ui/States';
import type { Role } from './api/client';
import './styles/global.css';

/**
 * Route guards are convenience, not security: the API checks the session and the
 * role on every request. These only keep the interface from showing a page it
 * cannot fill.
 */
const Protegida = ({
  roles,
  children,
}: {
  readonly roles?: readonly Role[];
  readonly children: React.ReactNode;
}) => {
  const { user, loading } = useSession();
  const localizacao = useLocation();

  if (loading) return <LoadingState rows={3} />;
  if (user === null) {
    return <Navigate to="/entrar" replace state={{ from: localizacao.pathname }} />;
  }
  if (roles !== undefined && !roles.includes(user.role)) return <Navigate to="/" replace />;

  return <>{children}</>;
};

const OPERACAO: readonly Role[] = ['ADMIN', 'OPERADOR'];

/**
 * The dashboard is an operations screen. A driver or a customer signing in lands on
 * the order list instead - sending them to a page they cannot read and bouncing
 * them back would be a redirect loop.
 */
const PaginaInicial = () => {
  const { user } = useSession();
  if (user !== null && !OPERACAO.includes(user.role)) return <Navigate to="/encomendas" replace />;
  return <Dashboard />;
};

export const App = () => (
  <SessionProvider>
    <ToastProvider>
      <Routes>
        <Route path="/entrar" element={<Login />} />
        <Route path="/estado" element={<SystemStatus />} />

        <Route
          element={
            <Protegida>
              <AppLayout />
            </Protegida>
          }
        >
          <Route index element={<PaginaInicial />} />
          <Route path="encomendas" element={<Orders />} />
          <Route path="encomendas/:id" element={<OrderDetail />} />
          <Route
            path="clientes"
            element={
              <Protegida roles={OPERACAO}>
                <Customers />
              </Protegida>
            }
          />
          <Route
            path="motoristas"
            element={
              <Protegida roles={OPERACAO}>
                <Drivers />
              </Protegida>
            }
          />
          <Route
            path="relatorios"
            element={
              <Protegida roles={OPERACAO}>
                <Reports />
              </Protegida>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  </SessionProvider>
);
