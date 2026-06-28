'use client'

import { cn } from '@/lib/utils'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}

const SIZES = {
  sm: { outer: 64,  pillW: 3,  pillH: 8,  radius: 20, textSize: 'text-[7px]' },
  md: { outer: 112, pillW: 5,  pillH: 14, radius: 36, textSize: 'text-[9px]' },
  lg: { outer: 160, pillW: 7,  pillH: 20, radius: 52, textSize: 'text-[11px]' },
}

const COUNT = 20

// Color interpolation: dark gray (top/inactive) → bright teal (bottom/active)
function pillColor(i: number): string {
  const t = i / (COUNT - 1)
  const gray = { r: 100, g: 110, b: 120 }
  const teal = { r: 45,  g: 212, b: 191 }
  const r = Math.round(gray.r + (teal.r - gray.r) * t)
  const g = Math.round(gray.g + (teal.g - gray.g) * t)
  const b = Math.round(gray.b + (teal.b - gray.b) * t)
  return `rgb(${r},${g},${b})`
}

export function Spinner({ size = 'md', className, label = 'Loading...' }: SpinnerProps) {
  const { outer, pillW, pillH, radius, textSize } = SIZES[size]

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className="relative" style={{ width: outer, height: outer }}>

        {/* Rotating ring — the whole ring spins so the gradient sweeps around */}
        <div
          className="absolute inset-0"
          style={{ animation: 'spinner-rotate 1.4s linear infinite' }}
        >
          {Array.from({ length: COUNT }).map((_, i) => {
            const angle = (i * 360) / COUNT
            const opacity = 0.18 + (i / (COUNT - 1)) * 0.82
            const color = pillColor(i)

            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  width: pillW,
                  height: pillH,
                  borderRadius: pillW / 2,
                  backgroundColor: color,
                  opacity,
                  top: '50%',
                  left: '50%',
                  transform: `rotate(${angle}deg) translateX(-50%) translateY(-${radius + pillH / 2}px)`,
                  transformOrigin: 'center top',
                }}
              />
            )
          })}
        </div>

        {/* Center label sits on top, does NOT rotate */}
        {label && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className={cn('font-semibold tracking-widest uppercase text-muted-foreground select-none', textSize)}>
              {label}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
