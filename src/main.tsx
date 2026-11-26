import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import '@fontsource-variable/karla';
import '@fontsource-variable/bricolage-grotesque';
import './style.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  navigator.serviceWorker.register('/sw.js').catch(console.error);
