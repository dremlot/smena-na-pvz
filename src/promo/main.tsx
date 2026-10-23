// Иконка и обложка для каталога Яндекс Игр, собранные из тех же персонажей, что и в игре.
// Открыть: npm run dev → /promo.html?art=icon или ?art=cover — и сделать скриншот элемента.

import { createRoot } from 'react-dom/client'
import '../fonts'
import { CHARACTERS } from '../game/data'
import { Avatar } from '../ui/Avatar'
import './promo.css'

const look = (name: string) => CHARACTERS.find(c => c.name === name)!.look

function Box({ w, h, tone = '#c9925a', label, style }: { w: number; h: number; tone?: string; label?: boolean; style?: React.CSSProperties }) {
  return (
    <div className="box" style={{ width: w, height: h, background: tone, ...style }}>
      <div className="box-lid" />
      <div className="box-tape" />
      {label && (
        <div className="box-label">
          <div className="box-bars" />
          <div className="box-code">ПВЗ</div>
        </div>
      )}
    </div>
  )
}

function Cat({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 100 70" width={size} height={size * 0.7} aria-hidden="true">
      <path d="M18 70 V30 L10 4 L34 20 H66 L90 4 L82 30 V70 Z" fill="#e0893a" />
      <path d="M26 16 L18 8 L22 24 Z M74 16 L82 8 L78 24 Z" fill="#f4b183" />
      <ellipse cx="36" cy="40" rx="5" ry="7" fill="#1d2733" />
      <ellipse cx="64" cy="40" rx="5" ry="7" fill="#1d2733" />
      <circle cx="37.5" cy="37.5" r="1.8" fill="#fff" />
      <circle cx="65.5" cy="37.5" r="1.8" fill="#fff" />
      <path d="M46 50 L50 54 L54 50 Z" fill="#c25b5b" />
      <path d="M50 54 Q44 60 40 56 M50 54 Q56 60 60 56" stroke="#1d2733" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M30 52 H8 M30 56 H10 M70 52 H92 M70 56 H90" stroke="#1d2733" strokeWidth="1.5" />
    </svg>
  )
}

function Icon() {
  return (
    <div id="art" className="icon">
      <div className="icon-sun" />
      <div className="icon-person">
        <Avatar look={look('Школьник Дима')} mood="happy" size={330} />
      </div>
      <Box w={420} h={250} tone="#c98f55" label style={{ position: 'absolute', left: 46, bottom: -6 }} />
      <div className="icon-laser" />
    </div>
  )
}

function Cover() {
  return (
    <div id="art" className="cover">
      <div className="cover-wall" />
      <div className="cover-title">
        <div className="cover-eyebrow">симулятор пункта выдачи</div>
        <div className="cover-name">Смена<br />на ПВЗ</div>
        <div className="cover-pitch">Найди коробку. Спаси кота.<br />Не потеряй рейтинг.</div>
      </div>
      <div className="cover-queue">
        <div className="q q3"><Avatar look={look('Дядя Валера')} mood="angry" size={120} /></div>
        <div className="q q2"><Avatar look={look('Блогерша Кира')} mood="tense" size={140} /></div>
        <div className="q q1"><Avatar look={look('Бабушка Зина')} mood="happy" size={176} /></div>
      </div>
      <div className="cover-counter" />
      <Box w={132} h={88} tone="#b9824c" style={{ position: 'absolute', right: 214, bottom: 74 }} />
      <Box w={150} h={100} tone="#d8a96f" label style={{ position: 'absolute', right: 46, bottom: 74 }} />
      <div className="cover-catbox">
        <div className="cover-cat"><Cat size={92} /></div>
        <Box w={118} h={74} tone="#c9925a" />
      </div>
    </div>
  )
}

const art = new URLSearchParams(location.search).get('art')
createRoot(document.getElementById('root')!).render(art === 'cover' ? <Cover /> : <Icon />)
