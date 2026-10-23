// События смены: описание и баланс каждого.
// Чтобы добавить новое событие — допиши его сюда и обработай в engine.ts (startEvent / finishEvent).

export type EventKind = 'delivery' | 'blackout' | 'inspection' | 'cat' | 'rush'

export type EventInfo = {
  title: string
  icon: string
  announce: string
  duration: number // секунд
}

export const EVENTS: Record<EventKind, EventInfo> = {
  delivery: {
    title: 'Завал от курьера',
    icon: '📦',
    announce: 'Курьер выгрузил гору коробок. Разложи их по полкам, пока он не уехал!',
    duration: 16,
  },
  blackout: {
    title: 'Отключили свет',
    icon: '🔦',
    announce: 'Света нет. Ищи ячейки фонариком — води по стеллажу.',
    duration: 15,
  },
  inspection: {
    title: 'Проверка от начальства',
    icon: '🕴',
    announce: 'Приехал проверяющий. Платят ×1,5, но за ошибки штраф двойной.',
    duration: 20,
  },
  cat: {
    title: 'Кот в коробке',
    icon: '🐱',
    announce: 'Одна ячейка мяукает и шевелится. Найди кота, пока он не сбежал!',
    duration: 14,
  },
  rush: {
    title: 'Час пик',
    icon: '🔥',
    announce: 'Все пришли после работы. Клиентов вдвое больше, чек +20%.',
    duration: 18,
  },
}

export const DELIVERY_BOXES = 8
export const DELIVERY_BONUS = 80
export const DELIVERY_PENALTY = 0.05 // рейтинга за каждую неразложенную коробку
export const CAT_REWARD = 120

export function eventsPerShift(day: number) {
  if (day <= 1) return 1
  if (day <= 3) return 2
  return 3
}
