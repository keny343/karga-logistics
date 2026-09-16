import { Navigate, Route, Routes } from 'react-router-dom';
import { SystemStatus } from './pages/SystemStatus';

export const App = () => (
  <Routes>
    <Route path="/" element={<SystemStatus />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);
