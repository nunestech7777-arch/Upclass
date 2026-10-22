import React, { useState } from 'react';
import { Camera } from 'lucide-react';
import './SellerAvatar.css';

export interface SellerAvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  rank?: number;
  showCrown?: boolean;
  editable?: boolean;
  onEdit?: () => void;
  className?: string;
  onClick?: () => void;
}

/** Extrai até 2 iniciais do nome do vendedor (ex: "Alex Lemos" -> "AL") */
export function getSellerInitials(name: string): string {
  if (!name) return 'V';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'V';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Gera uma cor de gradiente consistente baseada no nome */
function getAvatarGradient(name: string): string {
  const gradients = [
    // Combinações da paleta Upclass (texto branco legível em todas)
    'linear-gradient(135deg, #063FF1 0%, #02007C 100%)',
    'linear-gradient(135deg, #D92B82 0%, #8A1A55 100%)',
    'linear-gradient(135deg, #FC39CE 0%, #063FF1 100%)',
    'linear-gradient(135deg, #0E7490 0%, #02007C 100%)',
    'linear-gradient(135deg, #4D3BD6 0%, #02007C 100%)',
    'linear-gradient(135deg, #063FF1 0%, #0E7490 100%)',
    'linear-gradient(135deg, #B0226A 0%, #02007C 100%)',
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = (name.charCodeAt(i) + ((hash << 5) - hash)) | 0;
  }
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}

export function SellerAvatar({
  name,
  photoUrl,
  size = 'md',
  rank,
  editable = false,
  onEdit,
  className = '',
  onClick,
}: SellerAvatarProps) {
  const [imageError, setImageError] = useState(false);
  const initials = getSellerInitials(name);
  const hasValidPhoto = Boolean(photoUrl && !imageError);

  const rankClass =
    rank === 1 ? 'avatar-rank-1' :
    rank === 2 ? 'avatar-rank-2' :
    rank === 3 ? 'avatar-rank-3' : '';

  const handleClick = (e: React.MouseEvent) => {
    if (editable && onEdit) {
      e.stopPropagation();
      onEdit();
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <div
      className={`seller-avatar-container size-${size} ${rankClass} ${className} ${editable ? 'is-editable' : ''}`}
      onClick={handleClick}
      role={editable || onClick ? 'button' : undefined}
      tabIndex={editable || onClick ? 0 : undefined}
      title={editable ? `Editar foto de ${name}` : name}
    >
      <div className="seller-avatar-ring">
        {hasValidPhoto ? (
          <img
            src={photoUrl!}
            alt={name}
            className="seller-avatar-image"
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            className="seller-avatar-initials"
            style={{ background: getAvatarGradient(name) }}
          >
            <span>{initials}</span>
          </div>
        )}

        {editable && (
          <div className="seller-avatar-edit-overlay">
            <Camera size={size === 'xl' ? 18 : size === 'lg' ? 16 : 12} color="#ffffff" />
          </div>
        )}
      </div>
    </div>
  );
}
