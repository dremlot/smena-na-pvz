// Задания на смену: три короткие цели с наградой.
// Прогресс считается по статистике смены, поэтому логику смены трогать не нужно.

export type TaskKind = 'serve' | 'clean' | 'combo' | 'noLost' | 'talk' | 'big' | 'earn'

export type Task = { id: string; kind: TaskKind; target: number; reward: number }

// Статистика смены, по которой проверяются задания
export type TaskStats = {
  served: number
  mistakes: number
  lost: number
  maxCombo: number
  goodTalks: number
  bigOrders: number
  earned: number
}

export function taskTitle(t: Task): string {
  switch (t.kind) {
    case 'serve': return `Выдай ${t.target} заказов`
    case 'clean': return `Выдай ${t.target} заказов без единой ошибки`
    case 'combo': return `Сделай серию из ${t.target} выдач подряд`
    case 'noLost': return 'Чтобы никто не ушёл без заказа'
    case 'talk': return `Уйди с миром из ${t.target} разговоров`
    case 'big': return `Выдай ${t.target} заказа по 2+ коробки`
    case 'earn': return `Заработай ${t.target.toLocaleString('ru-RU')} ₽ за смену`
  }
}

// Текущий прогресс: [сколько есть, сколько нужно]
export function taskProgress(t: Task, s: TaskStats): [number, number] {
  switch (t.kind) {
    case 'serve': return [s.served, t.target]
    case 'clean': return [s.mistakes ? 0 : s.served, t.target]
    case 'combo': return [s.maxCombo, t.target]
    case 'noLost': return [s.lost ? 0 : 1, 1]
    case 'talk': return [s.goodTalks, t.target]
    case 'big': return [s.bigOrders, t.target]
    case 'earn': return [s.earned, t.target]
  }
}

// «Без ушедших» и «без ошибок» проваливаются насовсем — это видно до конца смены
export function taskFailed(t: Task, s: TaskStats) {
  return (t.kind === 'noLost' && s.lost > 0) || (t.kind === 'clean' && s.mistakes > 0)
}

export function taskDone(t: Task, s: TaskStats) {
  const [have, need] = taskProgress(t, s)
  return !taskFailed(t, s) && have >= need
}

// Три разных задания. Цели растут со сменами, награда — с целью.
export function makeTasks(day: number, multiBox: boolean): Task[] {
  const k = Math.min(day, 12)
  const pool: { kind: TaskKind; target: number; reward: number }[] = [
    { kind: 'serve', target: 6 + k, reward: 120 + k * 25 },
    { kind: 'clean', target: 4 + Math.ceil(k / 2), reward: 150 + k * 25 },
    { kind: 'combo', target: 3 + Math.ceil(k / 3), reward: 130 + k * 20 },
    { kind: 'noLost', target: 1, reward: 180 + k * 25 },
    { kind: 'talk', target: 2 + Math.floor(k / 4), reward: 110 + k * 15 },
    { kind: 'earn', target: Math.round((700 + k * 180) / 50) * 50, reward: 150 + k * 25 },
  ]
  if (multiBox) pool.push({ kind: 'big', target: 2 + Math.floor(k / 3), reward: 140 + k * 20 })
  return pool
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((t, i) => ({ ...t, id: `${day}-${i}-${t.kind}` }))
}
