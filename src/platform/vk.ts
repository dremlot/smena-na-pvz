// Связь с VK Games (ВКонтакте и Одноклассники) через VK Bridge.
// Набор функций тот же, что в yandex.ts, поэтому игре всё равно, где она запущена:
// нужный файл подставляется при сборке (npm run build:vk).
// Вне VK (локально, в превью) всё работает на заглушках.

import bridge from '@vkontakte/vk-bridge'

// Игру внутри VK узнаём по параметрам запуска, которые VK добавляет к адресу
const inVK = new URLSearchParams(location.search).has('vk_app_id')
let ready = false

export const onYandex = () => false
export const onVK = () => inVK && ready

const INIT_TIMEOUT = 5000
// Своя пауза между полноэкранными рекламами, чтобы не раздражать игроков
const FULLSCREEN_COOLDOWN = 90_000
let lastFullscreen = 0

// ---------- Запуск ----------

export async function initPlatform(): Promise<void> {
  if (!inVK) return
  try {
    await Promise.race([
      bridge.send('VKWebAppInit'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), INIT_TIMEOUT)),
    ])
    ready = true
  } catch {
    ready = false
    return
  }
  // Заранее подгружаем рекламу, чтобы она показалась сразу, когда нужно
  preload('interstitial')
  preload('reward')
}

function preload(format: 'interstitial' | 'reward') {
  bridge.send('VKWebAppCheckNativeAds', { ad_format: format }).catch(() => {})
}

export function language(): string {
  return new URLSearchParams(location.search).get('vk_language') ?? 'ru'
}

// У VK нет отдельной разметки загрузки и геймплея — функции оставлены для совместимости
export function gameReady() {}
export function gameplayStart() {}
export function gameplayStop() {}

// VK сообщает, что окно игры скрыли (свернули приложение, открыли чат) и вернули
export function onPlatformPause(pause: () => void, resume: () => void) {
  if (!onVK()) return
  bridge.subscribe(e => {
    if (e.detail.type === 'VKWebAppViewHide') pause()
    if (e.detail.type === 'VKWebAppViewRestore') resume()
  })
}

// ---------- Реклама ----------

type AdHooks = { onStart: () => void; onEnd: () => void }

async function show(format: 'interstitial' | 'reward', h: AdHooks): Promise<boolean> {
  try {
    const check = await bridge.send('VKWebAppCheckNativeAds', { ad_format: format })
    if (!check.result) return false
    h.onStart()
    const res = await bridge.send('VKWebAppShowNativeAds', { ad_format: format })
    return !!res.result
  } catch {
    return false
  } finally {
    h.onEnd()
    preload(format)
  }
}

export async function showFullscreen(h: AdHooks): Promise<void> {
  if (!onVK()) return
  if (Date.now() - lastFullscreen < FULLSCREEN_COOLDOWN) return
  lastFullscreen = Date.now()
  await show('interstitial', h)
}

// Реклама за награду. true — игрок досмотрел и получает награду
export function showRewarded(h: AdHooks): Promise<boolean> {
  if (!onVK()) {
    // Заглушка для разработки
    h.onStart()
    return new Promise(resolve => setTimeout(() => { h.onEnd(); resolve(true) }, 1500))
  }
  return show('reward', h)
}

// ---------- Сохранения ----------
// Копия в браузере + хранилище VK (VKWebAppStorage), чтобы прогресс был на любом устройстве.
// Значение одного ключа в хранилище VK ограничено, поэтому длинное сохранение режем на куски.

const SAVE_KEY = 'pvz-sim-save-v1'
const CHUNK = 3000
const MAX_CHUNKS = 8
const CLOUD_EVERY = 3000

type Stamped = { savedAt?: number }

function readLocal<T>(): (T & Stamped) | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const chunkKeys = Array.from({ length: MAX_CHUNKS }, (_, i) => `save${i}`)

async function readCloud<T>(): Promise<(T & Stamped) | null> {
  if (!onVK()) return null
  try {
    const res = await bridge.send('VKWebAppStorageGet', { keys: ['saveParts', ...chunkKeys] })
    const map = new Map(res.keys.map(k => [k.key, k.value]))
    const parts = Number(map.get('saveParts') || 0)
    if (!parts) return null
    const raw = chunkKeys.slice(0, parts).map(k => map.get(k) ?? '').join('')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function loadSave<T>(): Promise<T | null> {
  const local = readLocal<T>()
  const cloud = await readCloud<T>()
  if (!cloud) return local
  if (!local) return cloud
  return (cloud.savedAt ?? 0) >= (local.savedAt ?? 0) ? cloud : local
}

let cloudTimer: ReturnType<typeof setTimeout> | null = null
let lastCloud = 0
let pending: string | null = null

async function pushCloud() {
  if (!onVK() || pending === null) return
  const raw = pending
  pending = null
  lastCloud = Date.now()
  const parts = Math.ceil(raw.length / CHUNK)
  if (parts > MAX_CHUNKS) return // не влезло — останется копия в браузере
  try {
    for (let i = 0; i < parts; i++) {
      await bridge.send('VKWebAppStorageSet', { key: chunkKeys[i], value: raw.slice(i * CHUNK, (i + 1) * CHUNK) })
    }
    // Число частей пишем последним: пока оно старое, читается целое старое сохранение
    await bridge.send('VKWebAppStorageSet', { key: 'saveParts', value: String(parts) })
  } catch {
    // попробуем при следующем сохранении
  }
}

export function writeSave(data: object, flush = false) {
  const stamped = JSON.stringify({ ...data, savedAt: Date.now() })
  try {
    localStorage.setItem(SAVE_KEY, stamped)
  } catch {
    // хранилище браузера недоступно — останется облако VK
  }
  if (!onVK()) return
  pending = stamped
  if (cloudTimer) clearTimeout(cloudTimer)
  const wait = flush ? 0 : Math.max(0, CLOUD_EVERY - (Date.now() - lastCloud))
  cloudTimer = setTimeout(pushCloud, wait)
}
