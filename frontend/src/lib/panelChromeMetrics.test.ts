import { describe, expect, it } from 'vitest';
import {
  PANEL_TOP_BAR_HEIGHT_PX,
  PANEL_TOP_BAR_HEIGHT_VAR,
} from './panelChromeMetrics';
import { PANEL_TOP_BAR_HEIGHT_PX as FromChrome } from '../components/ui/PanelChrome';

describe('panelChromeMetrics (F2#12)', () => {
  it('exports a stable shared top-bar height for F1 Story toolbar', () => {
    expect(PANEL_TOP_BAR_HEIGHT_PX).toBe(36);
    expect(PANEL_TOP_BAR_HEIGHT_VAR).toBe('--panel-top-bar-height');
    expect(FromChrome).toBe(PANEL_TOP_BAR_HEIGHT_PX);
  });
});
