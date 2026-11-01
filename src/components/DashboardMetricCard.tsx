import React from 'react';
import { ChevronRight } from 'lucide-react';
import './DashboardMetricCard.css';
import { CountUpValue } from './ui/AnimatedNumber';

export interface DashboardMetricCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  sublabel?: string;
  iconColor?: string;
  clickable?: boolean;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
  className?: string;
  title?: string;
}

export function DashboardMetricCard({
  icon,
  value,
  label,
  sublabel,
  iconColor,
  clickable = false,
  active = false,
  badge,
  onClick,
  className = '',
  title,
}: DashboardMetricCardProps) {
  const isInteractive = clickable && !!onClick;

  return (
    <div
      className={`dashboard-metric-card ${isInteractive ? 'interactive' : ''} ${active ? 'active' : ''} ${className}`}
      onClick={isInteractive ? onClick : undefined}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      title={title || (isInteractive ? `Clique para ver detalhes de ${label}` : undefined)}
    >
      {badge && <span className="metric-card-badge">{badge}</span>}
      <div className="metric-icon-wrapper" style={{ color: iconColor }}>
        {icon}
      </div>
      <span className="metric-card-value">
        <CountUpValue value={value} />
      </span>
      <span className="metric-card-label">{label}</span>
      {sublabel && <span className="metric-card-sublabel">{sublabel}</span>}
      {isInteractive && (
        <div className="metric-card-hint">
          <span>Ver detalhes</span>
          <ChevronRight size={12} />
        </div>
      )}
    </div>
  );
}
