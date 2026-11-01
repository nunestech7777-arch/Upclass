import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Crown } from "lucide-react"
import { cn } from "@/lib/utils"
import "./leaderboard-podium.css"
import { AnimatedText } from "./AnimatedNumber"

// Types
export interface LeaderboardRanking {
  userId: string
  userName: string | null
  rank: number
  value: number
  avatarUrl?: string | null
}

// Variants
const podiumVariants = cva("flex items-end justify-center gap-4", {
  variants: {
    size: {
      sm: "gap-2",
      default: "gap-4",
      lg: "gap-6",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

// Podium styles for each position
const PODIUM_CONFIG = {
  1: {
    icon: Crown,
    color: "text-rank-1",
    bg: "bg-rank-1",
    ringColor: "ring-rank-1/50",
    height: "h-32",
    heightSm: "h-24",
    heightLg: "h-40",
  },
  2: {
    icon: Crown,
    color: "text-rank-2",
    bg: "bg-rank-2",
    ringColor: "ring-rank-2/50",
    height: "h-24",
    heightSm: "h-20",
    heightLg: "h-32",
  },
  3: {
    icon: Crown,
    color: "text-rank-3",
    bg: "bg-rank-3",
    ringColor: "ring-rank-3/50",
    height: "h-20",
    heightSm: "h-16",
    heightLg: "h-28",
  },
} as const

// Props
export interface LeaderboardPodiumProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof podiumVariants> {
  /** Top 3 rankings (expects at least 1, ideally 3) */
  rankings: LeaderboardRanking[]
  /** Show value below name */
  showValue?: boolean
  /** Show avatar */
  showAvatar?: boolean
  /** Crown badge style variant */
  medalStyle?: "classic" | "modern" | "minimal"
}

const LeaderboardPodium = React.forwardRef<
  HTMLDivElement,
  LeaderboardPodiumProps
>(
  (
    {
      className,
      size = "default",
      rankings,
      showValue = true,
      showAvatar = true,
      medalStyle = "classic",
      ...props
    },
    ref
  ) => {
    // Get top 3, reorder for podium display: 2nd, 1st, 3rd
    const top3 = rankings.slice(0, 3)
    const podiumOrder = [
      top3.find((r) => r.rank === 2),
      top3.find((r) => r.rank === 1),
      top3.find((r) => r.rank === 3),
    ].filter(Boolean) as LeaderboardRanking[]

    if (podiumOrder.length === 0) {
      return null
    }

    const avatarClass = {
      sm: "avatar-sm",
      default: "avatar-default",
      lg: "avatar-lg",
    }[size ?? "default"]

    const iconSize = {
      sm: 14,
      default: 18,
      lg: 22,
    }[size ?? "default"]

    const crownBadgeClass = {
      sm: "crown-badge-sm",
      default: "crown-badge-default",
      lg: "crown-badge-lg",
    }[size ?? "default"]

    const crownIconSize = {
      sm: 10,
      default: 14,
      lg: 18,
    }[size ?? "default"]

    const textClass = {
      sm: "name-sm",
      default: "name-default",
      lg: "name-lg",
    }[size ?? "default"]

    const podiumWidthClass = {
      sm: "podium-w-sm",
      default: "podium-w-default",
      lg: "podium-w-lg",
    }[size ?? "default"]

    return (
      <div
        ref={ref}
        className={cn("leaderboard-podium-root", podiumVariants({ size }), className)}
        role="list"
        aria-label="Top 3 rankings"
        {...props}
      >
        {podiumOrder.map((ranking) => {
          const config = PODIUM_CONFIG[ranking.rank as 1 | 2 | 3]
          if (!config) return null

          const displayName =
            ranking.userName || `Vendedor ${ranking.userId.slice(0, 6)}`
          
          // Generate a reliable nice avatar or initial fallback
          const avatarSrc =
            ranking.avatarUrl ||
            `https://images.unsplash.com/photo-${
              ranking.rank === 1
                ? '1534528741775-53994a69daeb'
                : ranking.rank === 2
                  ? '1507003211169-0a1dd7228f2d'
                  : '1500648767791-00dcc994a43e'
            }?auto=format&fit=crop&w=256&q=80`

          const podiumHeightClass = `podium-rank-${ranking.rank}-${size ?? 'default'}`
          const itemLabel = `Posição ${ranking.rank}: ${displayName}${showValue ? `, ${ranking.value.toLocaleString()} un.` : ""}`

          return (
            <div
              key={ranking.userId}
              role="listitem"
              aria-label={itemLabel}
              className="podium-item"
            >
              {/* Avatar with crown */}
              <div className="podium-avatar-container" aria-hidden="true">
                {showAvatar ? (
                  <img
                    src={avatarSrc}
                    alt={`${displayName} avatar`}
                    className={cn("podium-avatar-img", avatarClass)}
                    onError={(e) => {
                      // Fallback gracefully to styled initials
                      const target = e.currentTarget
                      target.style.display = 'none'
                      if (target.nextElementSibling) {
                        (target.nextElementSibling as HTMLElement).style.display = 'flex'
                      }
                    }}
                  />
                ) : null}

                <div
                  className={cn(
                    "podium-avatar-fallback",
                    avatarClass,
                    config.bg
                  )}
                  style={{ display: showAvatar ? 'none' : 'flex' }}
                >
                  <config.icon size={iconSize} className={config.color} />
                </div>

                {/* Crown badge */}
                {medalStyle !== "minimal" && (
                  <div
                    className={cn(
                      "podium-crown-badge",
                      crownBadgeClass
                    )}
                  >
                    <config.icon
                      size={crownIconSize}
                      className={config.color}
                    />
                  </div>
                )}
              </div>

              {/* Name */}
              <span
                className={cn("podium-user-name", textClass)}
                title={displayName}
              >
                {displayName}
              </span>

              {/* Value */}
              {showValue && (
                <span className="podium-user-value">
                  <AnimatedText text={ranking.value.toLocaleString('pt-BR')} />
                </span>
              )}

              {/* Podium block */}
              <div
                aria-hidden="true"
                className={cn(
                  "podium-block",
                  podiumWidthClass,
                  podiumHeightClass,
                  config.bg,
                  medalStyle === "modern" && "podium-modern-radius"
                )}
              >
                <div className={cn("podium-number", config.color)}>
                  {ranking.rank}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }
)

LeaderboardPodium.displayName = "LeaderboardPodium"

export { LeaderboardPodium, podiumVariants }
