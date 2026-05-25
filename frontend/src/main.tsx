import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme } from './theme';
import './tokens.css';
import './index.css';

// Dark-only: paint the theme attributes before first render so tokens resolve.
applyTheme('dark');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
