import type { CSSProperties } from 'react';
import { useTheme } from '../context/ThemeContext';

/**
 * Tema central dos gráficos Upclass. Espelha os tokens --chart-* de index.css em valores
 * concretos, porque o Recharts precisa de cores literais em alguns pontos (gradientes, canvas).
 * Ordem das séries: azul elétrico, ciano, magenta, rosa, violeta, âmbar.
 */
export interface ChartTheme {
  series: [string, string, string, string, string, string];
  primary: string;
  success: string;
  warning: string;
  danger: string;
  grid: string;
  axis: string;
  reference: string;
  text: string;
  surface: string;
  border: string;
}

const DARK: ChartTheme = {
  series: ['#4D7BFF', '#80FFFF', '#FC39CE', '#FF7AB8', '#A99BFF', '#FBBF24'],
  primary: '#4D7BFF',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#FF7A8C',
  grid: 'rgba(142, 166, 255, 0.12)',
  axis: '#8A91BE',
  reference: '#8A91BE',
  text: '#E4E8FF',
  surface: '#0B1150',
  border: 'rgba(142, 166, 255, 0.22)',
};

const LIGHT: ChartTheme = {
  series: ['#063FF1', '#0891B2', '#C026A8', '#B0226A', '#6D5BD0', '#B45309'],
  primary: '#063FF1',
  success: '#047857',
  warning: '#B45309',
  danger: '#C81E3A',
  grid: '#E6E8F2',
  axis: '#6B7096',
  reference: '#8A8FB0',
  text: '#0A0D3B',
  surface: '#FFFFFF',
  border: '#E6E8F2',
};

export function chartThemeFor(theme: 'light' | 'dark'): ChartTheme {
  return theme === 'dark' ? DARK : LIGHT;
}

export function useChartTheme(): ChartTheme {
  const { theme } = useTheme();
  return chartThemeFor(theme);
}

/** Estilo padrão de tooltip do Recharts (HTML), coerente com os cards. */
export function tooltipStyle(c: ChartTheme): CSSProperties {
  return {
    backgroundColor: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    color: c.text,
    boxShadow: '0 12px 32px -12px rgba(0, 2, 41, 0.45)',
    fontSize: 13,
  };
}
