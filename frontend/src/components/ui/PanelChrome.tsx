import React from 'react';
import './PanelChrome.css';

/** F2#12 — re-export shared top-bar metrics for F1 Story toolbar consumers. */
export {
  PANEL_TOP_BAR_HEIGHT_PX,
  PANEL_TOP_BAR_HEIGHT_VAR,
} from '../../lib/panelChromeMetrics';

interface PanelChromeProps {
  children: React.ReactNode;
  className?: string;
}

interface PanelHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

interface PanelBodyProps {
  children: React.ReactNode;
  className?: string;
}

interface PanelFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function PanelChrome({ children, className }: PanelChromeProps) {
  const cls = className ? `pc-chrome ${className}` : 'pc-chrome';
  return <div className={cls}>{children}</div>;
}

export function PanelHeader({ title, subtitle, icon, actions, className }: PanelHeaderProps) {
  const cls = className ? `pc-header ${className}` : 'pc-header';
  // Critic #6 / N7: production never mounts PanelChrome (.pc-chrome), so the
  // @container wrap must live on a real ancestor of .pc-header. This host is
  // that ancestor — at ≤320px the header wraps instead of clipping.
  return (
    <div className="pc-header-host">
      <div className={cls}>
        <div className="pc-header-start">
          {icon !== undefined && <div className="pc-header-icon">{icon}</div>}
          <div className="pc-header-title-group">
            <div className="pc-header-title">{title}</div>
            {subtitle !== undefined && <div className="pc-header-subtitle">{subtitle}</div>}
          </div>
        </div>
        {actions !== undefined && <div className="pc-header-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function PanelBody({ children, className }: PanelBodyProps) {
  const cls = className ? `pc-body ${className}` : 'pc-body';
  return <div className={cls}>{children}</div>;
}

export function PanelFooter({ children, className }: PanelFooterProps) {
  const cls = className ? `pc-footer ${className}` : 'pc-footer';
  return <div className={cls}>{children}</div>;
}
