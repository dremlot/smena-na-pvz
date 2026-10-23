// Связь с Яндекс Играми: SDK, разметка геймплея, реклама, облачные сохранения.
// Если игра открыта не на Яндексе (локально, в превью), всё работает на заглушках:
// реклама «показывается» 1,5 секунды, сохранения живут только в браузере.

type Callbacks = {
  onOpen?: () => void
  onClose?: (wasShown?: boolean) => void
  onRewarded?: () => void
  onError?: (e: unknown) => void
}

type Player = {
  getData: (keys?: string[]) => Promise<Record<string, unknown>>
  setData: (data: Record<string, unknown>, flush?: boolean) => Promise<void>
}

type YSDK = {
  adv: {
    showFullscreenAdv: (o: { callbacks: Callbacks }) => void
    showRewardedVideo: (o: { callbacks: Callbacks }) => void
  }
  features?: {
    LoadingAPI?: { ready: () => void }
    GameplayAPI?: { start: () => void; stop: () => void }
  }
  environment?: { i18n?: { lang?: string } }
  getPlayer: (o?: { scopes?: boolean }) => Promise<Player>
  on?: (event: string, cb: () => void) => void
}

let ysdk: YSDK | null = null
let player: Player | null = null
let ready = false
let playing = false

const INIT_TIMEOUT = 5000

export const onYandex = () => ysdk !== null

// ---------- Запуск ----------

export async function initPlatform(): Promise<void> {
  const w = window as unknown as { YaGames?: { init: () => Promise<YSDK> } }
  if (!w.YaGames) return
  try {
    // Не ждём SDK вечно: если он завис, игра всё равно запустится
    ysdk = await Promise.race([
      w.YaGames.init(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), INIT_TIMEOUT)),
    ])
  } catch {
    ysdk = null
  }
  if (!ysdk) return
  try {
    // scopes: false — без запроса доступа к профилю, сохранения работают и для гостей
    player = await ysdk.getPlayer({ scopes: false })
  } catch {
    player = null
  }
}

// Язык игрока по данным Яндекса. Игра пока только на русском,
// но язык определяем через SDK, как требует модерация (п. 2.14).
export function language(): string {
  return ysdk?.environment?.i18n?.lang ?? 'ru'
}

// Игра загрузилась и готова к нажатиям — вызывается один раз (п. 1.19.2)
export function gameReady() {
  if (ready) return
  ready = true
  ysdk?.features?.LoadingAPI?.ready()
}

// Разметка геймплея (п. 1.19.3): start — смена идёт, stop — меню, отчёт, реклама, вкладка скрыта
export function gameplayStart() {
  if (playing) return
  playing = true
  ysdk?.features?.GameplayAPI?.start()
}

export function gameplayStop() {
  if (!playing) return
  playing = false
  ysdk?.features?.GameplayAPI?.stop()
}

// Платформа сама просит паузу (например, открыла своё окно поверх игры)
export function onPlatformPause(pause: () => void, resume: () => void) {
  ysdk?.on?.('game_api_pause', pause)
  ysdk?.on?.('game_api_resume', resume)
}

// ---------- Реклама ----------
// onStart/onEnd нужны, чтобы на время рекламы выключить звук и остановить игру (п. 4.7)

type AdHooks = { onStart: () => void; onEnd: () => void }

export function showFullscreen(h: AdHooks): Promise<void> {
  if (!ysdk) return Promise.resolve()
  return new Promise(resolve => {
    let started = false
    const end = () => {
      if (started) h.onEnd()
      resolve()
    }
    ysdk!.adv.showFullscreenAdv({
      callbacks: {
        onOpen: () => { started = true; h.onStart() },
        onClose: () => end(),
        onError: () => end(),
      },
    })
  })
}

// Реклама за награду. true — игрок досмотрел и получает награду
export function showRewarded(h: AdHooks): Promise<boolean> {
  if (!ysdk) {
    // Заглушка для разработки
    h.onStart()
    return new Promise(resolve => setTimeout(() => { h.onEnd(); resolve(true) }, 1500))
  }
  return new Promise(resolve => {
    let rewarded = false
    let started = false
    ysdk!.adv.showRewardedVideo({
      callbacks: {
        onOpen: () => { started = true; h.onStart() },
        onRewarded: () => { rewarded = true },
        onClose: () => { if (started) h.onEnd(); resolve(rewarded) },
        onError: () => { if (started) h.onEnd(); resolve(false) },
      },
    })
  })
}

// ---------- Сохранения ----------
// Копия всегда пишется в браузер, а на Яндексе ещё и в облако игрока (п. 1.9, 1.11).
// При загрузке берём более свежую из двух — по метке времени savedAt.

const SAVE_KEY = 'pvz-sim-save-v1'
const CLOUD_KEY = 'save'
const CLOUD_EVERY = 3000 // не чаще раза в 3 секунды, чтобы не упереться в лимиты SDK

type Stamped = { savedAt?: number }

function readLocal<T>(): (T & Stamped) | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function loadSave<T>(): Promise<T | null> {
  const local = readLocal<T>()
  let cloud: (T & Stamped) | null = null
  if (player) {
    try {
      const data = await player.getData([CLOUD_KEY])
      cloud = (data?.[CLOUD_KEY] as T & Stamped) ?? null
    } catch {
      cloud = null
    }
  }
  if (!cloud) return local
  if (!local) return cloud
  return (cloud.savedAt ?? 0) >= (local.savedAt ?? 0) ? cloud : local
}

let cloudTimer: ReturnType<typeof setTimeout> | null = null
let lastCloud = 0
let pending: unknown = null

function pushCloud(flush: boolean) {
  if (!player || pending === null) return
  const data = pending
  pending = null
  lastCloud = Date.now()
  player.setData({ [CLOUD_KEY]: data }, flush).catch(() => { /* попробуем при следующем сохранении */ })
}

// flush — сохранить в облако сразу (конец смены, покупка), иначе не чаще раза в 3 секунды
export function writeSave(data: object, flush = false) {
  const stamped = { ...data, savedAt: Date.now() }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(stamped))
  } catch {
    // хранилище недоступно (приватный режим) — останется облако
  }
  if (!player) return
  pending = stamped
  if (cloudTimer) clearTimeout(cloudTimer)
  const wait = flush ? 0 : Math.max(0, CLOUD_EVERY - (Date.now() - lastCloud))
  cloudTimer = setTimeout(() => pushCloud(flush), wait)
}
