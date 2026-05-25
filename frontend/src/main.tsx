import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme } from './theme';
import { applyThemeAxis, THEME_AXIS_DEFAULT } from './themeAxis';
import './tokens.css';
import './index.css';

// Dark-only: paint the theme attributes before first render so tokens resolve.
applyTheme('dark');
// Pin the Softness↔Contrast axis to its default before first paint; DesktopShell
// re-applies the persisted position once settings load (MYT-518).
applyThemeAxis(THEME_AXIS_DEFAULT);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
