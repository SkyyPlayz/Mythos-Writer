import React from 'react';
import './PanelChrome.css';

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
  return (
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
