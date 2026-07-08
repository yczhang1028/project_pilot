import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { ModalHostProvider } from './ui/ModalHost';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ModalHostProvider>
      <App />
    </ModalHostProvider>
  </React.StrictMode>
);
