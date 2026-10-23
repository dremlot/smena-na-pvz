// Звуки синтезируются прямо в браузере — никаких файлов, игра остаётся лёгкой.

import type { FxKind } from '../game/engine'

let ctx: AudioContext | null = null
let muted = false     // выключил сам игрок
let suspended = false // выключила игра: реклама, свёрнутая вкладка, пауза платформы

export function setMuted(v: boolean) {
  muted = v
}

// Полная тишина на время рекламы и когда вкладка не видна (п. 1.3 и 4.7 требований)
export function setSuspended(v: boolean) {
  suspended = v
  if (!ctx) return
  if (v) ctx.suspend().catch(() => {})
  else ctx.resume().catch(() => {})
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended' && !suspended) ctx.resume().catch(() => {})
  return ctx
}

// Один тон: частота, длительность, тип волны, громкость, частота в конце (для «скольжения»)
function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.08, slideTo?: number, delay = 0) {
  if (muted || suspended) return
  const a = audio()
  if (!a) return
  const t0 = a.currentTime + delay
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  gain.gain.setValueAtTime(vol, t0)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(gain).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export function click() {
  tone(520, 0.03, 'square', 0.04)
}

export function play(kind: FxKind) {
  switch (kind) {
    case 'beep': // сканер
      tone(1760, 0.09, 'square', 0.06)
      break
    case 'coin':
      tone(988, 0.08, 'triangle', 0.12)
      tone(1319, 0.18, 'triangle', 0.12, undefined, 0.07)
      break
    case 'error':
      tone(150, 0.22, 'sawtooth', 0.08, 110)
      break
    case 'pick':
      tone(300, 0.1, 'sine', 0.14, 620)
      break
    case 'place':
      tone(220, 0.08, 'sine', 0.14, 140)
      break
    case 'event':
      tone(880, 0.12, 'square', 0.05)
      tone(660, 0.12, 'square', 0.05, undefined, 0.14)
      tone(880, 0.12, 'square', 0.05, undefined, 0.28)
      break
    case 'meow':
      tone(620, 0.12, 'sine', 0.12, 1050)
      tone(1050, 0.25, 'sine', 0.1, 560, 0.12)
      break
    case 'happy':
      tone(660, 0.08, 'triangle', 0.08)
      tone(880, 0.12, 'triangle', 0.08, undefined, 0.07)
      break
    case 'angry':
      tone(260, 0.15, 'triangle', 0.1, 180)
      tone(200, 0.25, 'triangle', 0.1, 140, 0.13)
      break
  }
}
