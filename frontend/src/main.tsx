import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles/global.css';

const raiz = document.getElementById('root');
if (raiz === null) throw new Error('Elemento #root não existe no documento.');

createRoot(raiz).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
