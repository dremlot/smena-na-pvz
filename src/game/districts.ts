// Сеть пунктов: районы, в которых можно открыть точку.
// У каждого района свой характер — через множители к базовому балансу.

import type { EventKind } from './events'

export type DistrictId = 'home' | 'center' | 'campus' | 'office'

export type District = {
  name: string
  icon: string
  pitch: string        // одна строка о характере района
  traits: string[]     // что меняется в игре — показываем игроку честно
  cost: number         // цена открытия точки
  rank: number         // какое звание нужно (индекс в RANKS)
  patience: number     // множитель терпения клиентов
  pay: number          // множитель чека
  spawn: number        // множитель интервала между клиентами (<1 — чаще)
  extraBoxes: number   // сколько мест в заказе добавляется к обычному
  talk: number         // доля «разговорных» клиентов
  penalty: number      // базовый множитель штрафов
  events: Partial<Record<EventKind, number>> // веса событий (по умолчанию 1)
}

export const DISTRICT_ORDER: DistrictId[] = ['home', 'center', 'campus', 'office']

export const DISTRICTS: Record<DistrictId, District> = {
  home: {
    name: 'Спальный район',
    icon: '🏘',
    pitch: 'Бабушки, мамы с колясками и бесконечные возвраты.',
    traits: ['Обычный темп', 'Первая точка сети'],
    cost: 0, rank: 0,
    patience: 1, pay: 1, spawn: 1, extraBoxes: 0, talk: 0.25, penalty: 1,
    events: {},
  },
  center: {
    name: 'Центр',
    icon: '🏙',
    pitch: 'Все спешат, блогеры требуют выдать без очереди.',
    traits: ['Чек +35%', 'Терпение −25%', 'Больше разговоров'],
    cost: 5000, rank: 1,
    patience: 0.75, pay: 1.35, spawn: 0.85, extraBoxes: 0, talk: 0.35, penalty: 1,
    events: { rush: 2.5 },
  },
  campus: {
    name: 'Студгородок',
    icon: '🎓',
    pitch: 'Заказы на всю общагу, коты и вечный час пик.',
    traits: ['Чек +25%', '+1 место в заказе', 'Чаще коты, завалы и час пик'],
    cost: 15000, rank: 2,
    patience: 1, pay: 1.25, spawn: 0.9, extraBoxes: 1, talk: 0.2, penalty: 1,
    events: { cat: 3, delivery: 2, rush: 2 },
  },
  office: {
    name: 'Бизнес-центр',
    icon: '🏢',
    pitch: 'Начальство за стенкой, каждая ошибка на виду.',
    traits: ['Чек +75%', 'Штрафы ×1,5', 'Проверка каждую смену'],
    cost: 40000, rank: 3,
    patience: 0.9, pay: 1.75, spawn: 0.95, extraBoxes: 0, talk: 0.25, penalty: 1.5,
    events: { inspection: 100 },
  },
}

// ---------- Звания ----------
// Растут от общего числа выданных заказов за всю игру.

export const RANKS = [
  { title: 'Стажёр', at: 0 },
  { title: 'Оператор', at: 30 },
  { title: 'Старший оператор', at: 90 },
  { title: 'Управляющий', at: 180 },
  { title: 'Владелец сети', at: 320 },
]

export function rankOf(served: number) {
  let r = 0
  RANKS.forEach((rank, i) => { if (served >= rank.at) r = i })
  return r
}
