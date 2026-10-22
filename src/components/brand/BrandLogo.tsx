import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import logoLight from '../../assets/brand/upclass/logo-light.png';
import logoDark from '../../assets/brand/upclass/logo-dark.png';
import logoPhoneLight from '../../assets/brand/upclass/logo-phone-light.png';
import logoPhoneDark from '../../assets/brand/upclass/logo-phone-dark.png';
import symbol from '../../assets/brand/upclass/symbol.png';

/**
 * Assinaturas oficiais da Upclass (arquivos do manual, apenas recortados e reduzidos).
 * `on` indica o fundo onde a logo aparece: "dark" usa a versão clara e vice-versa;
 * "theme" acompanha o tema atual.
 */
type Surface = 'dark' | 'light' | 'theme';

interface BrandLogoProps {
  variant?: 'full' | 'phone';
  on?: Surface;
  className?: string;
  alt?: string;
}

export function BrandLogo({ variant = 'full', on = 'theme', className, alt }: BrandLogoProps) {
  const { theme } = useTheme();
  const darkSurface = on === 'theme' ? theme === 'dark' : on === 'dark';
  const src = variant === 'phone'
    ? (darkSurface ? logoPhoneLight : logoPhoneDark)
    : (darkSurface ? logoLight : logoDark);
  return (
    <img
      src={src}
      alt={alt ?? (variant === 'phone' ? 'Upclass Phone' : 'Upclass')}
      className={className}
      decoding="async"
    />
  );
}

/** Símbolo dos dois raios — detalhe de navegação, estado vazio ou marca d'água. */
export function BrandSymbol({ className, decorative = true }: { className?: string; decorative?: boolean }) {
  return <img src={symbol} alt={decorative ? '' : 'Upclass'} aria-hidden={decorative || undefined} className={className} decoding="async" />;
}

/** Estado vazio padrão com o símbolo da marca. */
export function EmptyState({ title, children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="uc-empty" role="status">
      <BrandSymbol />
      {title && <strong>{title}</strong>}
      {children && <span>{children}</span>}
    </div>
  );
}
