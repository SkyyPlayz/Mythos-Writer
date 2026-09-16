import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme } from './theme';
import './tokens.css';
// Shared dialog/popover glass chrome (SKY-11450). Imported here, right after
// the tokens it reads, so it always precedes component stylesheets in the CSS
// bundle and a component can still override geometry at equal specificity.
import './overlay-tier.css';
import './index.css';
import './obsidianCommunityPluginStyles.css';

performance.mark('renderer:script-start');

// Dark-only: paint the theme attributes before first render so tokens resolve.
applyTheme('dark');
performance.mark('renderer:theme-applied');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
performance.mark('renderer:react-scheduled');
