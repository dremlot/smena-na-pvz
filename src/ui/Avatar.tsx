// Рисованный персонаж из простых фигур.
// Внешность задаётся в data.ts (Look), эмоция — пропсом mood.

import type { Look } from '../game/data'
import type { Mood } from '../game/engine'

type Props = { look: Look; mood: Mood; size?: number; title?: string }

export function Avatar({ look, mood, size = 120, title }: Props) {
  const { skin, hair, hairColor, shirt } = look
  const ink = '#1d2733'

  return (
    <svg viewBox="0 0 100 120" width={size} height={size * 1.2} role="img" aria-label={title} className={`avatar avatar-${mood}`}>
      {/* Длинные волосы и пучок — за головой */}
      {hair === 'long' && <path d="M22 48 Q22 20 50 20 Q78 20 78 48 L80 92 L20 92 Z" fill={hairColor} />}
      {hair === 'bun' && <circle cx="50" cy="18" r="11" fill={hairColor} />}

      {/* Плечи и шея */}
      <path d="M14 120 Q14 88 50 86 Q86 88 86 120 Z" fill={shirt} />
      <path d="M40 86 Q50 96 60 86" fill="none" stroke="rgba(0,0,0,.18)" strokeWidth="2" />
      <rect x="43" y="70" width="14" height="18" rx="6" fill={skin} />

      {/* Голова и уши */}
      <circle cx="25" cy="52" r="6" fill={skin} />
      <circle cx="75" cy="52" r="6" fill={skin} />
      <ellipse cx="50" cy="50" rx="25" ry="27" fill={skin} />

      {/* Причёски поверх головы */}
      {hair === 'short' && <path d="M25 46 Q24 22 50 22 Q76 22 75 46 Q68 32 50 32 Q32 32 25 46 Z" fill={hairColor} />}
      {hair === 'long' && <path d="M25 46 Q26 22 50 22 Q74 22 75 46 Q62 30 44 34 Q32 38 25 46 Z" fill={hairColor} />}
      {hair === 'bun' && <path d="M25 44 Q26 23 50 23 Q74 23 75 44 Q60 31 50 31 Q40 31 25 44 Z" fill={hairColor} />}
      {hair === 'curly' && (
        <g fill={hairColor}>
          {[[30, 32], [40, 25], [52, 23], [63, 26], [71, 34], [26, 42], [74, 43]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="9" />)}
        </g>
      )}
      {hair === 'mohawk' && <path d="M44 34 Q46 12 50 10 Q54 12 56 34 Z" fill={hairColor} />}
      {hair === 'cap' && (
        <g>
          <path d="M24 42 Q24 20 50 20 Q76 20 76 42 Z" fill={hairColor} />
          <path d="M50 40 L88 42 Q86 47 50 45 Z" fill={hairColor} />
          <circle cx="50" cy="21" r="2.5" fill="rgba(0,0,0,.25)" />
        </g>
      )}
      {hair === 'kerchief' && (
        <g>
          <path d="M21 52 Q20 18 50 18 Q80 18 79 52 Q72 30 50 30 Q28 30 21 52 Z" fill={hairColor} />
          <path d="M22 50 Q18 70 30 76 L36 66 Z" fill={hairColor} />
          <circle cx="38" cy="26" r="2" fill="#fff" opacity=".7" />
          <circle cx="56" cy="23" r="2" fill="#fff" opacity=".7" />
          <circle cx="68" cy="30" r="2" fill="#fff" opacity=".7" />
        </g>
      )}

      <Face mood={mood} ink={ink} />

      {/* Борода и усы */}
      {look.beard && <path d="M30 56 Q32 80 50 80 Q68 80 70 56 Q66 70 50 70 Q34 70 30 56 Z" fill={hairColor === '#000' ? '#3a2a20' : hairColor} />}
      {look.mustache && <path d="M38 63 Q44 58 50 62 Q56 58 62 63 Q56 66 50 64 Q44 66 38 63 Z" fill={look.hairColor === '#000' ? '#3a2a20' : look.hairColor} />}

      {/* Очки */}
      {look.glasses && (
        <g fill="rgba(255,255,255,.25)" stroke={ink} strokeWidth="2">
          <circle cx="40" cy="49" r="7.5" />
          <circle cx="60" cy="49" r="7.5" />
          <path d="M47.5 49 L52.5 49" fill="none" />
        </g>
      )}
    </svg>
  )
}

function Face({ mood, ink }: { mood: Mood; ink: string }) {
  return (
    <g>
      {/* Брови: у злого — сведены */}
      {mood === 'angry' ? (
        <g stroke={ink} strokeWidth="2.6" strokeLinecap="round">
          <path d="M33 39 L45 43" />
          <path d="M67 39 L55 43" />
        </g>
      ) : mood === 'tense' ? (
        <g stroke={ink} strokeWidth="2.2" strokeLinecap="round">
          <path d="M34 41 L45 40" />
          <path d="M66 41 L55 40" />
        </g>
      ) : (
        <g stroke={ink} strokeWidth="2.2" strokeLinecap="round" fill="none">
          <path d="M34 40 Q39 36 45 39" />
          <path d="M66 40 Q61 36 55 39" />
        </g>
      )}

      {/* Глаза: у довольного — дужки */}
      {mood === 'happy' ? (
        <g stroke={ink} strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d="M36 50 Q40 45 44 50" />
          <path d="M56 50 Q60 45 64 50" />
        </g>
      ) : (
        <g fill={ink}>
          <ellipse cx="40" cy="49" rx="3" ry={mood === 'angry' ? 2.4 : 3.4} />
          <ellipse cx="60" cy="49" rx="3" ry={mood === 'angry' ? 2.4 : 3.4} />
        </g>
      )}

      {/* Румянец у довольного, пар у злого */}
      {mood === 'happy' && (
        <g fill="#e66a6a" opacity=".35">
          <ellipse cx="33" cy="58" rx="5" ry="3" />
          <ellipse cx="67" cy="58" rx="5" ry="3" />
        </g>
      )}

      {/* Рот */}
      <g stroke={ink} strokeWidth="2.6" strokeLinecap="round" fill="none">
        {mood === 'happy' && <path d="M40 62 Q50 72 60 62" fill="#8a2f2f" />}
        {mood === 'calm' && <path d="M42 64 Q50 68 58 64" />}
        {mood === 'tense' && <path d="M43 66 L57 65" />}
        {mood === 'angry' && <path d="M41 68 Q50 60 59 68" />}
      </g>
    </g>
  )
}
