// Вся игровая логика: состояние, правила, редьюсер.
// React тут не нужен — эти функции можно тестировать отдельно.
//
// Цикл выдачи заказа:
//   1. клиент диктует код        → игрок вбивает его в терминал (или сканирует QR)
//   2. терминал показывает ячейки → игрок открывает ячейку и выбирает нужную коробку
//      среди похожих кодов (9522, 9252, 5922…)
//   3. все коробки на стойке      → игрок пробивает выдачу сканером
//
// Когда отключают свет, терминал тоже гаснет: коды видны только на коробках
// в луче фонарика, и коробки берутся прямо со стеллажа.

import {
  ANGRY_LINES, BOX_TONES, CHARACTERS, ITEMS, PICKUP_LINES, SITUATIONS, THANKS_LINES, WRONG_CODE_LINES,
  type Look, type Situation,
} from './data'
import { CAT_REWARD, DELIVERY_BONUS, DELIVERY_BOXES, DELIVERY_PENALTY, EVENTS, eventsPerShift, type EventKind } from './events'
import { DISTRICTS, RANKS, rankOf, type DistrictId } from './districts'
import { makeTasks, taskDone, taskTitle, type Task, type TaskStats } from './tasks'

// ---------- Типы ----------

export type Parcel = { id: number; code: string; cell: number; tone: string }

export type Client = {
  id: number
  name: string
  look: Look
  kind: 'pickup' | 'talk'
  code: string
  situation?: Situation
  line: string
  patience: number
  maxPatience: number
}

export type Mood = 'calm' | 'tense' | 'angry' | 'happy'

export type Departing = { client: Client; mood: 'happy' | 'angry'; line: string; t: number }

export type Lookup = { code: string; cells: number[]; item: string; boxes: number }

export type Upgrades = {
  sign: number    // Вывеска: больше клиентов и выше чек
  coffee: number  // Кофемашина: клиенты терпеливее
  qr: number      // QR-сканер: код вводится одной кнопкой
  shelf: number   // Умный стеллаж: подсвечивает нужные ячейки
  intern: number  // Стажёр: сам выдаёт заказы
}

export type Toast = { id: number; text: string; tone: 'good' | 'bad' | 'info' }

// Эффекты для интерфейса: звук, всплывающий текст, тряска
export type FxKind = 'coin' | 'error' | 'beep' | 'pick' | 'place' | 'event' | 'meow' | 'happy' | 'angry'
export type Fx = { id: number; kind: FxKind; text?: string }

export type Shift = {
  timeLeft: number
  queue: Client[]
  parcels: Parcel[]
  items: Record<string, string> // код заказа → что внутри
  spawnTimer: number
  internTimer: number
  earned: number
  served: number
  talked: number
  mistakes: number
  lost: number
  combo: number
  // Для заданий
  maxCombo: number
  goodTalks: number
  bigOrders: number
  district: DistrictId
  // Стойка и терминал
  input: string
  lookup: Lookup | null
  lookupError: boolean
  counter: Parcel[]
  openCell: number | null // открытая ячейка, из которой выбираем коробку
  departing: Departing | null
  // События
  schedule: { kind: EventKind; at: number }[]
  active: { kind: EventKind; timeLeft: number } | null
  unloading: Parcel[]
  placed: number
  catCell: number | null
  log: string[]
}

export type DayResult = {
  earned: number; served: number; talked: number; mistakes: number; lost: number; doubled: boolean; events: string[]
  tasks: { title: string; reward: number; done: boolean }[]
  taskMoney: number
  rankUp: string | null
}

export type Phase = 'menu' | 'shift' | 'dayEnd' | 'shop' | 'map'

export type GameState = {
  phase: Phase
  day: number
  money: number
  rating: number // 1..5
  upgrades: Upgrades // улучшения текущей точки
  district: DistrictId
  owned: DistrictId[]
  upgradesBy: Partial<Record<DistrictId, Upgrades>> // улучшения остальных точек
  totalServed: number // за всю игру — от этого растёт звание
  tasks: Task[]       // задания на ближайшую смену
  shift: Shift | null
  result: DayResult | null
  toasts: Toast[]
  fx: Fx[]
}

// ---------- Баланс ----------
// Все цифры в одном месте: крутишь их — меняется сложность.

export const SHIFT_SECONDS = 90
export const CELLS = 18
export const CELL_CAPACITY = 4
export const MAX_QUEUE = 4
export const MAX_RATING = 5
const DEPART_TIME = 0.9 // сколько клиент стоит и радуется/злится перед уходом

export const UPGRADES: Record<keyof Upgrades, { title: string; icon: string; max: number; base: number; describe: (lvl: number) => string }> = {
  sign: { title: 'Вывеска', icon: '🪧', max: 5, base: 250, describe: l => `Чек +${l * 20}%, клиентов больше` },
  coffee: { title: 'Кофемашина', icon: '☕', max: 3, base: 180, describe: l => `Терпение клиентов +${l * 4} с` },
  qr: { title: 'QR-сканер', icon: '📟', max: 1, base: 2500, describe: () => 'Код заказа вводится одной кнопкой' },
  shelf: { title: 'Умный стеллаж', icon: '💡', max: 1, base: 3500, describe: () => 'Подсвечивает ячейки заказа. Коробку внутри ищешь сама' },
  intern: {
    title: 'Стажёр', icon: '🧑‍🔧', max: 3, base: 1000,
    describe: l => `Выдаёт заказ раз в ${internEvery(Math.max(1, l))} с, клиентов +${Math.max(1, l) * 12}%. Берёт 30% с заказа, без света не работает`,
  },
}

export function upgradeCost(key: keyof Upgrades, lvl: number) {
  return Math.round(UPGRADES[key].base * Math.pow(1.7, lvl))
}

function internEvery(lvl: number) {
  return 22 - lvl * 4
}

const INTERN_SHARE = 0.3    // его зарплата — доля выручки с заказа

export const isBlackout = (shift: Shift | null) => shift?.active?.kind === 'blackout'

const districtOf = (shift: Shift) => DISTRICTS[shift.district]

function maxBoxes(day: number) {
  return day <= 1 ? 1 : day <= 3 ? 2 : 3
}

function spawnEvery(u: Upgrades, shift: Shift) {
  // Со стажёром пункт пропускает больше людей — и клиентов приходит больше
  const base = Math.max(2.2, (7 - u.sign * 0.6) * (1 - u.intern * 0.12) * districtOf(shift).spawn)
  return shift.active?.kind === 'rush' ? base * 0.45 : base
}

function boxPay(state: GameState, shift: Shift) {
  const base = 40 * (1 + state.upgrades.sign * 0.2)
  const ratingMult = 0.6 + (state.rating / MAX_RATING) * 0.6
  const eventMult = shift.active?.kind === 'inspection' ? 1.5 : shift.active?.kind === 'rush' ? 1.2 : 1
  return base * ratingMult * eventMult * districtOf(shift).pay
}

// Штрафы: базовые для района, при проверке — вдвое больше
const penaltyMult = (shift: Shift) => districtOf(shift).penalty * (shift.active?.kind === 'inspection' ? 2 : 1)

// События выбираются с весами района: в студгородке чаще коты, в бизнес-центре — проверки
function planEvents(day: number, district: DistrictId): Shift['schedule'] {
  const slots: Record<number, number[]> = { 1: [60], 2: [72, 38], 3: [78, 52, 26] }
  const n = eventsPerShift(day)
  const weights = DISTRICTS[district].events
  let pool = (Object.keys(EVENTS) as EventKind[]).map(kind => ({ kind, w: weights[kind] ?? 1 }))
  const kinds: EventKind[] = []
  while (kinds.length < n && pool.length) {
    let r = Math.random() * pool.reduce((a, b) => a + b.w, 0)
    const chosen = pool.find(p => (r -= p.w) <= 0) ?? pool[pool.length - 1]
    kinds.push(chosen.kind)
    pool = pool.filter(p => p !== chosen)
  }
  kinds.sort(() => Math.random() - 0.5)
  return kinds.map((kind, i) => ({ kind, at: slots[n][i] }))
}

// ---------- Генерация ----------

let nextId = 1
const uid = () => nextId++
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

function randomCode(taken: Set<string>) {
  let code: string
  do code = String(Math.floor(1000 + Math.random() * 9000))
  while (taken.has(code))
  return code
}

function cellLoad(parcels: Parcel[]) {
  const load = new Array(CELLS).fill(0)
  parcels.forEach(p => { if (p.cell >= 0) load[p.cell]++ })
  return load
}

// Самые пустые ячейки — туда и кладём, как на настоящем складе
function freeCells(parcels: Parcel[], n: number): number[] {
  const load = cellLoad(parcels)
  return load
    .map((l, i) => ({ l, i, r: Math.random() }))
    .filter(c => c.l < CELL_CAPACITY)
    .sort((a, b) => a.l - b.l || a.r - b.r)
    .slice(0, n)
    .map(c => c.i)
}

// Код, похожий на данный: переставлены две цифры или заменена одна.
// Из-за таких соседей в ячейке приходится читать код внимательно.
function similarCode(base: string, taken: Set<string>): string | null {
  for (let tries = 0; tries < 12; tries++) {
    const d = base.split('')
    if (Math.random() < 0.55) {
      const i = Math.floor(Math.random() * 3)
      ;[d[i], d[i + 1]] = [d[i + 1], d[i]]
    } else {
      const i = Math.floor(Math.random() * 4)
      d[i] = String((Number(d[i]) + 1 + Math.floor(Math.random() * 8)) % 10)
    }
    const code = d.join('')
    if (code !== base && code[0] !== '0' && !taken.has(code)) return code
  }
  return null
}

// Чем дальше смены, тем чаще в ячейке лежат почти одинаковые коды
function similarChance(day: number) {
  return Math.min(0.9, 0.6 + day * 0.07)
}

// Новый заказ из 1–3 коробок, разложенных по разным ячейкам
function addOrder(shift: Shift, day: number): Shift {
  const taken = new Set([...shift.parcels, ...shift.unloading].map(p => p.code))
  const most = maxBoxes(day) + districtOf(shift).extraBoxes
  const want = 1 + Math.floor(Math.random() * Math.random() * most * 1.6)
  const cells = freeCells(shift.parcels, Math.min(want, most))
  if (!cells.length) return shift
  const neighbours = shift.parcels.filter(p => p.cell === cells[0])
  const code = (neighbours.length && Math.random() < similarChance(day) && similarCode(pick(neighbours).code, taken)) || randomCode(taken)
  const tone = pick(BOX_TONES)
  const boxes = cells.map(cell => ({ id: uid(), code, cell, tone }))
  return { ...shift, parcels: [...shift.parcels, ...boxes], items: { ...shift.items, [code]: pick(ITEMS) } }
}

function makeClient(state: GameState, shift: Shift): [Client | null, Shift] {
  const who = pick(CHARACTERS)
  const maxPatience = Math.round((20 + state.upgrades.coffee * 4) * districtOf(shift).patience)
  const base = { id: uid(), name: who.name, look: who.look, patience: maxPatience, maxPatience }

  // Каждый четвёртый — с разговором, но не в первые секунды первой смены
  const talkChance = state.day === 1 && shift.timeLeft > SHIFT_SECONDS - 15 ? 0 : districtOf(shift).talk
  if (Math.random() < talkChance) {
    const situation = pick(SITUATIONS)
    return [{ ...base, kind: 'talk', code: '', situation, line: situation.text, maxPatience: maxPatience + 6, patience: maxPatience + 6 }, shift]
  }

  // Приходит за заказом, который лежит на полках и не нужен никому в очереди
  const waiting = new Set(shift.queue.map(c => c.code))
  let available = [...new Set(shift.parcels.map(p => p.code))].filter(c => !waiting.has(c))
  if (!available.length) {
    shift = addOrder(shift, state.day)
    available = [...new Set(shift.parcels.map(p => p.code))].filter(c => !waiting.has(c))
    if (!available.length) return [null, shift]
  }
  return [{ ...base, kind: 'pickup', code: pick(available), line: pick(PICKUP_LINES) }, shift]
}

// ---------- Действия ----------

export type Action =
  | { type: 'start' }
  | { type: 'tick'; dt: number }
  | { type: 'key'; digit: string }
  | { type: 'backspace' }
  | { type: 'submitCode' }
  | { type: 'scanQr' }
  | { type: 'tapCell'; cell: number }
  | { type: 'closeCell' }
  | { type: 'takeBox'; parcelId: number }
  | { type: 'handOver' }
  | { type: 'answer'; index: number }
  | { type: 'placeParcel'; parcelId: number }
  | { type: 'doubleReward' }
  | { type: 'openShop' }
  | { type: 'openMenu' }
  | { type: 'openMap' }
  | { type: 'selectDistrict'; id: DistrictId }
  | { type: 'buyDistrict'; id: DistrictId }
  | { type: 'buy'; key: keyof Upgrades }
  | { type: 'dropToast'; id: number }
  | { type: 'dropFx'; id: number }
  | { type: 'reset' }
  | { type: 'load'; save: Partial<SaveData> }

export type SaveData = Pick<GameState, 'day' | 'money' | 'rating' | 'upgrades' | 'district' | 'owned' | 'upgradesBy' | 'totalServed' | 'tasks'>

// Что сохраняем между сессиями
export function saveOf(s: GameState): SaveData {
  return { day: s.day, money: s.money, rating: s.rating, upgrades: s.upgrades, district: s.district, owned: s.owned, upgradesBy: s.upgradesBy, totalServed: s.totalServed, tasks: s.tasks }
}

const noUpgrades: Upgrades = { sign: 0, coffee: 0, qr: 0, shelf: 0, intern: 0 }

export const initialState: GameState = {
  phase: 'menu',
  day: 1,
  money: 0,
  rating: 4,
  upgrades: noUpgrades,
  district: 'home',
  owned: ['home'],
  upgradesBy: {},
  totalServed: 0,
  tasks: [],
  shift: null,
  result: null,
  toasts: [],
  fx: [],
}

const clampRating = (r: number) => Math.max(1, Math.min(MAX_RATING, r))

function toast(state: GameState, text: string, tone: Toast['tone']): GameState {
  return { ...state, toasts: [...state.toasts.slice(-2), { id: uid(), text, tone }] }
}

function fx(state: GameState, kind: FxKind, text?: string): GameState {
  return { ...state, fx: [...state.fx.slice(-6), { id: uid(), kind, text }] }
}

// Можно ли сейчас работать с первым клиентом
function frontReady(shift: Shift | null): Client | null {
  if (!shift || shift.departing) return null
  return shift.queue[0] ?? null
}

// Первый клиент уходит: сбрасываем терминал, возвращаем коробки со стойки на полки
function releaseFront(shift: Shift, mood: 'happy' | 'angry', line: string, keepCounter = false): Shift {
  const [front, ...rest] = shift.queue
  const back = keepCounter ? [] : shift.counter
  return {
    ...shift,
    queue: rest,
    parcels: [...shift.parcels, ...back],
    counter: [],
    input: '',
    lookup: null,
    lookupError: false,
    openCell: null,
    departing: { client: front, mood, line, t: DEPART_TIME },
  }
}

// Ошибка игрока: клиент злится, серия сгорает, на проверке — минус рейтинг
function mistake(state: GameState, shift: Shift, text: string, patienceHit: number): GameState {
  const [front, ...rest] = shift.queue
  const queue = front ? [{ ...front, patience: Math.max(1, front.patience - patienceHit) }, ...rest] : shift.queue
  const rating = shift.active?.kind === 'inspection' ? clampRating(state.rating - 0.1) : state.rating
  const s = { ...state, rating, shift: { ...shift, queue, mistakes: shift.mistakes + 1, combo: 0 } }
  return fx(toast(s, text, 'bad'), 'error')
}

function payOrder(state: GameState, shift: Shift, boxes: number, byIntern: boolean): [GameState, number] {
  const front = shift.queue[0]
  const speed = front.patience / front.maxPatience
  const combo = byIntern ? shift.combo : shift.combo + 1
  const pay = Math.round(boxPay(state, shift) * (1 + (boxes - 1) * 0.7) * (1 + speed * 0.5) * (1 + Math.min(combo, 10) * 0.04))
  const sh = { ...shift, earned: shift.earned + pay, served: shift.served + 1, combo, maxCombo: Math.max(shift.maxCombo, combo) }
  return [{ ...state, shift: sh, rating: clampRating(state.rating + (byIntern ? 0.01 : 0.03)) }, pay]
}

// ---------- События ----------

function startEvent(state: GameState, shift: Shift): [GameState, Shift] {
  const [{ kind }, ...schedule] = shift.schedule
  let sh: Shift = { ...shift, schedule, active: { kind, timeLeft: EVENTS[kind].duration } }

  if (kind === 'delivery') {
    const taken = new Set(sh.parcels.map(p => p.code))
    const unloading: Parcel[] = []
    const items = { ...sh.items }
    for (let i = 0; i < DELIVERY_BOXES; i++) {
      const code = randomCode(taken)
      taken.add(code)
      items[code] = pick(ITEMS)
      unloading.push({ id: uid(), code, cell: -1, tone: pick(BOX_TONES) })
    }
    sh = { ...sh, unloading, items, placed: 0 }
  }
  if (kind === 'cat') sh = { ...sh, catCell: Math.floor(Math.random() * CELLS) }
  // Без света гаснет и терминал: набранный код и найденные ячейки пропадают
  if (kind === 'blackout') sh = { ...sh, input: '', lookup: null, lookupError: false, openCell: null }

  const info = EVENTS[kind]
  return [fx(toast(state, `${info.icon} ${info.title}!`, 'info'), kind === 'cat' ? 'meow' : 'event'), sh]
}

function finishEvent(state: GameState, shift: Shift): [GameState, Shift] {
  const active = shift.active
  if (!active) return [state, shift]
  let s = state
  let sh: Shift = { ...shift, active: null }
  const info = EVENTS[active.kind]

  switch (active.kind) {
    case 'delivery': {
      const left = sh.unloading.length
      if (left) s = toast({ ...s, rating: clampRating(s.rating - left * DELIVERY_PENALTY) }, `Курьер увёз ${left} коробок обратно −рейтинг`, 'bad')
      sh = { ...sh, unloading: [], log: [...sh.log, `${info.icon} Разгружено ${sh.placed} из ${DELIVERY_BOXES}`] }
      break
    }
    case 'cat':
      if (sh.catCell !== null) {
        s = toast(s, 'Кот сбежал…', 'info')
        sh = { ...sh, catCell: null, log: [...sh.log, `${info.icon} Кот сбежал`] }
      }
      break
    default:
      sh = { ...sh, log: [...sh.log, `${info.icon} ${info.title} — пережили`] }
  }
  return [s, sh]
}

// ---------- Задания и конец смены ----------

function tasksFor(day: number, district: DistrictId) {
  return makeTasks(day, day >= 2 || DISTRICTS[district].extraBoxes > 0)
}

export function statsOf(sh: Shift): TaskStats {
  return { served: sh.served, mistakes: sh.mistakes, lost: sh.lost, maxCombo: sh.maxCombo, goodTalks: sh.goodTalks, bigOrders: sh.bigOrders, earned: sh.earned }
}

function endShift(s: GameState, sh: Shift): GameState {
  const stats = statsOf(sh)
  const tasks = s.tasks.map(t => ({ title: taskTitle(t), reward: t.reward, done: taskDone(t, stats) }))
  const taskMoney = tasks.filter(t => t.done).reduce((a, t) => a + t.reward, 0)
  const before = rankOf(s.totalServed)
  const totalServed = s.totalServed + sh.served
  const after = rankOf(totalServed)
  return {
    ...s,
    phase: 'dayEnd',
    shift: null,
    toasts: [],
    totalServed,
    money: s.money + sh.earned + taskMoney,
    // Задания на следующую смену готовим сразу, чтобы показать их в меню
    tasks: tasksFor(s.day + 1, s.district),
    result: {
      earned: sh.earned, served: sh.served, talked: sh.talked, mistakes: sh.mistakes, lost: sh.lost,
      doubled: false, events: sh.log, tasks, taskMoney,
      rankUp: after > before ? RANKS[after].title : null,
    },
  }
}

// ---------- Редьюсер ----------

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'load': {
      const save = action.save
      return {
        ...state, ...save,
        upgrades: { ...noUpgrades, ...(save.upgrades ?? {}) },
        district: save.district ?? 'home',
        owned: save.owned?.length ? save.owned : ['home'],
        upgradesBy: save.upgradesBy ?? {},
        totalServed: save.totalServed ?? 0,
        tasks: save.tasks ?? [],
      }
    }

    case 'start': {
      let shift: Shift = {
        timeLeft: SHIFT_SECONDS, queue: [], parcels: [], items: {}, spawnTimer: 0.6, internTimer: 0,
        earned: 0, served: 0, talked: 0, mistakes: 0, lost: 0, combo: 0,
        maxCombo: 0, goodTalks: 0, bigOrders: 0, district: state.district,
        input: '', lookup: null, lookupError: false, counter: [], openCell: null, departing: null,
        schedule: planEvents(state.day, state.district), active: null, unloading: [], placed: 0, catCell: null, log: [],
      }
      for (let i = 0; i < 20; i++) shift = addOrder(shift, state.day)
      const tasks = state.tasks.length ? state.tasks : tasksFor(state.day, state.district)
      return { ...state, phase: 'shift', shift, tasks, result: null, toasts: [], fx: [] }
    }

    case 'tick': {
      const shift = state.shift
      if (state.phase !== 'shift' || !shift) return state
      const dt = action.dt
      let s: GameState = state
      let sh: Shift = { ...shift, timeLeft: shift.timeLeft - dt }

      // События
      if (sh.active) {
        const timeLeft = sh.active.timeLeft - dt
        if (timeLeft <= 0 || sh.timeLeft <= 0) [s, sh] = finishEvent(s, sh)
        else sh = { ...sh, active: { ...sh.active, timeLeft } }
      } else if (sh.schedule.length && sh.timeLeft <= sh.schedule[0].at) {
        [s, sh] = startEvent(s, sh)
      }

      // Конец смены
      if (sh.timeLeft <= 0) return endShift(s, sh)

      // Уходящий клиент
      if (sh.departing) {
        const t = sh.departing.t - dt
        sh = { ...sh, departing: t <= 0 ? null : { ...sh.departing, t } }
      }

      // Терпение. Тот, с кем работаем, ждёт быстрее «по ощущениям»
      sh = { ...sh, queue: sh.queue.map((c, i) => ({ ...c, patience: c.patience - dt * (i === 0 && !sh.departing ? 1 : 0.6) })) }
      if (sh.queue.some(c => c.patience <= 0)) {
        const front = sh.queue[0]
        const lost = sh.queue.filter(c => c.patience <= 0).length
        s = fx(toast({ ...s, rating: clampRating(s.rating - 0.15 * lost * penaltyMult(sh)) }, 'Клиент ушёл без заказа −рейтинг', 'bad'), 'angry')
        sh = { ...sh, lost: sh.lost + lost, combo: 0 }
        if (front.patience <= 0 && !sh.departing) {
          sh = releaseFront(sh, 'angry', pick(ANGRY_LINES))
          sh = { ...sh, queue: sh.queue.filter(c => c.patience > 0) }
        } else {
          sh = { ...sh, queue: sh.queue.filter((c, i) => c.patience > 0 || (i === 0 && !!sh.departing)) }
        }
      }

      // Новые клиенты и подвоз заказов
      sh = { ...sh, spawnTimer: sh.spawnTimer - dt }
      if (sh.spawnTimer <= 0) {
        sh = { ...sh, spawnTimer: spawnEvery(s.upgrades, sh) * (0.7 + Math.random() * 0.6) }
        if (sh.queue.length < MAX_QUEUE) {
          sh = addOrder(sh, s.day)
          const [c, next] = makeClient(s, sh)
          sh = next
          if (c) sh = { ...sh, queue: [...sh.queue, c] }
        }
      }

      // Стажёр берёт последнего в очереди клиента с посылкой.
      // Первого клиента всегда обслуживает игрок. Без света стажёр беспомощен.
      if (s.upgrades.intern > 0) {
        const busy = sh.queue.length >= 2 && !isBlackout(sh)
        sh = { ...sh, internTimer: busy ? sh.internTimer + dt : 0 }
        if (busy && sh.internTimer >= internEvery(s.upgrades.intern)) {
          sh = { ...sh, internTimer: 0 }
          const idx = sh.queue.map((c, i) => ({ c, i })).filter(({ c, i }) => i > 0 && c.kind === 'pickup').pop()?.i
          if (idx !== undefined) {
            const c = sh.queue[idx]
            const queue = sh.queue.filter((_, i) => i !== idx)
            const boxes = sh.parcels.filter(p => p.code === c.code).length
            const pay = Math.round(boxPay(s, sh) * (1 + (boxes - 1) * 0.7) * (1 - INTERN_SHARE))
            sh = { ...sh, queue, parcels: sh.parcels.filter(p => p.code !== c.code), earned: sh.earned + pay, served: sh.served + 1 }
            return fx(toast({ ...s, shift: sh, rating: clampRating(s.rating + 0.01) }, `Стажёр выдал заказ +${pay} ₽ (30% ему)`, 'good'), 'coin', `+${pay} ₽`)
          }
        }
      }

      return { ...s, shift: sh }
    }

    // ----- Терминал -----

    case 'key': {
      const shift = state.shift
      if (isBlackout(shift)) return toast(state, 'Терминал без питания', 'info')
      if (!frontReady(shift) || shift!.lookup || shift!.input.length >= 4) return state
      return { ...state, shift: { ...shift!, input: shift!.input + action.digit, lookupError: false } }
    }

    case 'backspace': {
      const shift = state.shift
      if (isBlackout(shift)) return state
      if (!frontReady(shift) || shift!.lookup) return state
      return { ...state, shift: { ...shift!, input: shift!.input.slice(0, -1) } }
    }

    case 'scanQr': {
      const shift = state.shift
      const front = frontReady(shift)
      if (!state.upgrades.qr || front?.kind !== 'pickup' || shift!.lookup || isBlackout(shift)) return state
      return reducer({ ...state, shift: { ...shift!, input: front.code } }, { type: 'submitCode' })
    }

    case 'submitCode': {
      const shift = state.shift
      const front = frontReady(shift)
      if (!shift || !front || front.kind !== 'pickup' || shift.lookup || shift.input.length < 4 || isBlackout(shift)) return state
      if (shift.input !== front.code) {
        return mistake(state, { ...shift, input: '', lookupError: true }, pick(WRONG_CODE_LINES), 3)
      }
      const boxes = shift.parcels.filter(p => p.code === front.code)
      const lookup: Lookup = {
        code: front.code,
        cells: [...new Set(boxes.map(p => p.cell))].sort((a, b) => a - b),
        item: shift.items[front.code] ?? 'Заказ',
        boxes: boxes.length,
      }
      return fx({ ...state, shift: { ...shift, lookup } }, 'beep')
    }

    // ----- Стеллаж -----

    case 'tapCell': {
      const shift = state.shift
      if (!shift) return state

      // Кот важнее всего
      if (shift.active?.kind === 'cat' && shift.catCell === action.cell) {
        const sh: Shift = { ...shift, catCell: null, active: null, earned: shift.earned + CAT_REWARD, log: [...shift.log, '🐱 Кот найден и пристроен'] }
        return fx(toast({ ...state, rating: clampRating(state.rating + 0.2), shift: sh }, `Кот спасён! +${CAT_REWARD} ₽`, 'good'), 'meow', `+${CAT_REWARD} ₽`)
      }

      // Без света коробки берутся прямо со стеллажа, ячейки не открываются
      if (isBlackout(shift)) return state
      const front = frontReady(shift)
      if (!front || front.kind !== 'pickup') return state
      if (!shift.lookup) return toast(state, 'Сначала пробей код в терминале', 'info')
      if (!shift.parcels.some(p => p.cell === action.cell)) return mistake(state, shift, `Ячейка ${action.cell + 1} пустая`, 1)
      return fx({ ...state, shift: { ...shift, openCell: action.cell } }, 'pick')
    }

    case 'closeCell': {
      const shift = state.shift
      if (!shift) return state
      return { ...state, shift: { ...shift, openCell: null } }
    }

    case 'takeBox': {
      const shift = state.shift
      const front = frontReady(shift)
      if (!shift || !front || front.kind !== 'pickup') return state
      const box = shift.parcels.find(p => p.id === action.parcelId)
      if (!box) return state
      const dark = isBlackout(shift)
      if (!dark && box.cell !== shift.openCell) return state
      if (box.code !== front.code) {
        return mistake(state, shift, `Это ${box.code}, а нужен ${front.code}`, 3)
      }
      const parcels = shift.parcels.filter(p => p.id !== box.id)
      const sh: Shift = { ...shift, parcels, counter: [...shift.counter, box], openCell: null }
      return fx({ ...state, shift: sh }, 'place')
    }

    case 'handOver': {
      const shift = state.shift
      const front = frontReady(shift)
      if (!shift || !front || front.kind !== 'pickup' || !shift.counter.length) return state
      const left = shift.parcels.filter(p => p.code === front.code).length
      if (left) return mistake(state, shift, `Не всё собрано: ещё ${left} шт. на полках`, 1)
      const [paid, pay] = payOrder(state, shift, shift.counter.length, false)
      const combo = paid.shift!.combo
      const big = shift.counter.length >= 2 ? 1 : 0
      const sh = releaseFront({ ...paid.shift!, bigOrders: paid.shift!.bigOrders + big }, 'happy', pick(THANKS_LINES), true)
      const msg = combo >= 3 ? `Выдано +${pay} ₽ · серия ×${combo}` : `Выдано +${pay} ₽`
      return fx(toast({ ...paid, shift: sh }, msg, 'good'), 'coin', `+${pay} ₽`)
    }

    // ----- Разговор -----

    case 'answer': {
      const shift = state.shift
      const front = frontReady(shift)
      const option = front?.situation?.options[action.index]
      if (!shift || !front || !option) return state
      const ratingDelta = option.rating < 0 ? option.rating * penaltyMult(shift) : option.rating
      let sh: Shift = { ...shift, earned: shift.earned + option.money, talked: shift.talked + 1, goodTalks: shift.goodTalks + (option.good ? 1 : 0) }
      sh = releaseFront(sh, option.good ? 'happy' : 'angry', option.reply)
      let s: GameState = { ...state, shift: sh, rating: clampRating(state.rating + ratingDelta) }
      if (option.money > 0) s = fx(s, 'coin', `+${option.money} ₽`)
      else if (option.money < 0) s = fx(s, 'error', `${option.money} ₽`)
      else s = fx(s, option.good ? 'happy' : 'angry')
      return s
    }

    // ----- Разгрузка -----

    case 'placeParcel': {
      const shift = state.shift
      if (!shift) return state
      const box = shift.unloading.find(p => p.id === action.parcelId)
      if (!box) return state
      const [cell] = freeCells(shift.parcels, 1)
      if (cell === undefined) return toast(state, 'Полки забиты!', 'bad')
      const unloading = shift.unloading.filter(p => p.id !== box.id)
      let next: Shift = { ...shift, unloading, parcels: [...shift.parcels, { ...box, cell }], placed: shift.placed + 1 }
      let s = fx({ ...state, shift: next }, 'place')
      if (!unloading.length) {
        next = { ...next, earned: next.earned + DELIVERY_BONUS }
        const [fin, sh] = finishEvent({ ...s, shift: next }, next)
        s = fx(toast({ ...fin, shift: sh }, `Разгрузка готова! +${DELIVERY_BONUS} ₽`, 'good'), 'coin', `+${DELIVERY_BONUS} ₽`)
      }
      return s
    }

    // ----- Между сменами -----

    case 'doubleReward': {
      const r = state.result
      if (!r || r.doubled) return state
      return fx({ ...state, money: state.money + r.earned, result: { ...r, doubled: true } }, 'coin')
    }

    case 'openShop':
      return { ...state, phase: 'shop', day: state.phase === 'dayEnd' ? state.day + 1 : state.day }

    case 'openMenu':
      return state.phase === 'shop' || state.phase === 'map' ? { ...state, phase: 'menu' } : state

    case 'openMap':
      return state.phase === 'menu' || state.phase === 'shop' ? { ...state, phase: 'map' } : state

    // Переезд между своими точками: улучшения у каждой свои
    case 'selectDistrict': {
      if (!state.owned.includes(action.id) || action.id === state.district) return state
      const upgradesBy = { ...state.upgradesBy, [state.district]: state.upgrades }
      return {
        ...state,
        district: action.id,
        upgrades: { ...noUpgrades, ...(upgradesBy[action.id] ?? {}) },
        upgradesBy,
      }
    }

    case 'buyDistrict': {
      const d = DISTRICTS[action.id]
      if (state.owned.includes(action.id) || state.money < d.cost || rankOf(state.totalServed) < d.rank) return state
      const bought = fx(toast({ ...state, money: state.money - d.cost, owned: [...state.owned, action.id] }, `Открыта точка: ${d.name}!`, 'good'), 'coin')
      return reducer(bought, { type: 'selectDistrict', id: action.id })
    }

    case 'buy': {
      const lvl = state.upgrades[action.key]
      const cost = upgradeCost(action.key, lvl)
      if (lvl >= UPGRADES[action.key].max || state.money < cost) return state
      return fx({ ...state, money: state.money - cost, upgrades: { ...state.upgrades, [action.key]: lvl + 1 } }, 'coin')
    }

    case 'dropToast':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) }

    // Полный сброс: день 1, без денег и улучшений
    case 'reset':
      return { ...initialState, upgrades: { ...noUpgrades } }

    case 'dropFx':
      return { ...state, fx: state.fx.filter(f => f.id !== action.id) }
  }
}

// Настроение клиента по шкале терпения — для лица и полоски
export function moodOf(c: Client): Mood {
  const r = c.patience / c.maxPatience
  return r > 0.6 ? 'calm' : r > 0.3 ? 'tense' : 'angry'
}
