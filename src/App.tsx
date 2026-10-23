import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { CHARACTERS } from './game/data'
import {
  CELLS, MAX_QUEUE, SHIFT_SECONDS, UPGRADES, initialState, isBlackout, moodOf, reducer, saveOf, statsOf, upgradeCost,
  type Action, type GameState, type SaveData, type Shift, type Upgrades,
} from './game/engine'
import { EVENTS } from './game/events'
import { DISTRICTS, DISTRICT_ORDER, RANKS, rankOf, type DistrictId } from './game/districts'
import { taskDone, taskFailed, taskProgress, taskTitle } from './game/tasks'
import {
  gameReady, gameplayStart, gameplayStop, initPlatform, loadSave, onPlatformPause, showFullscreen, showRewarded, writeSave,
} from '@platform'
import { Avatar } from './ui/Avatar'
import { click, play, setMuted, setSuspended } from './ui/sfx'
import { FitToScreen } from './ui/FitToScreen'

type Dispatch = React.Dispatch<Action>
type Floater = { id: number; text: string; tone: 'good' | 'bad' }
type AdHooks = { onStart: () => void; onEnd: () => void }

// Почему игра сейчас на паузе: вкладка скрыта, идёт реклама, платформа попросила.
// Пока есть хоть одна причина — смена стоит, звука нет, Яндексу сообщаем stop().
type PauseReason = 'hidden' | 'ad' | 'platform'

const MUTE_KEY = 'pvz-sim-muted'

// Своя мобильная сборка (без Яндекса и VK): кнопка полного экрана
const OWN_BUILD = import.meta.env.VITE_TARGET === 'web'

// Вибрация на телефоне: короткая на успех, длиннее на ошибку. Где её нет — ничего не происходит
function buzz(kind: string) {
  const v = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate
  if (!v) return
  try {
    if (kind === 'error') navigator.vibrate([60, 40, 60])
    else if (kind === 'coin') navigator.vibrate(25)
    else if (kind === 'pick' || kind === 'place') navigator.vibrate(10)
  } catch { /* браузер может запретить — не страшно */ }
}

// Полный экран и вертикальная ориентация — только в своей сборке, на площадках этим управляют они
function FullscreenButton() {
  const [on, setOn] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const f = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  // В Android-приложении игра и так на весь экран
  const native = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  if (!OWN_BUILD || native || !document.fullscreenEnabled) return null
  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else {
        await document.documentElement.requestFullscreen()
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
        await o.lock?.('portrait').catch(() => {})
      }
    } catch { /* отказ браузера — играем в окне */ }
  }
  return <button className="mute" onClick={toggle} aria-label={on ? 'Выйти из полного экрана' : 'Во весь экран'}>{on ? '🗗' : '⛶'}</button>
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [floaters, setFloaters] = useState<Floater[]>([])
  const [shake, setShake] = useState(0)
  const [muted, setMutedState] = useState(() => {
    try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
  })
  const seenFx = useRef(new Set<number>())
  const [booted, setBooted] = useState(false)
  const [pauses, setPauses] = useState<Set<PauseReason>>(() => new Set(document.hidden ? ['hidden'] : []))
  const paused = pauses.size > 0
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const setPause = useCallback((reason: PauseReason, on: boolean) => {
    setPauses(prev => {
      if (prev.has(reason) === on) return prev
      const next = new Set(prev)
      if (on) next.add(reason)
      else next.delete(reason)
      return next
    })
  }, [])

  // Запуск: SDK → сохранение (облако или браузер) → показываем меню
  useEffect(() => {
    let alive = true
    ;(async () => {
      await initPlatform()
      const save = await loadSave<SaveData>()
      if (!alive) return
      if (save) dispatch({ type: 'load', save })
      onPlatformPause(() => setPause('platform', true), () => setPause('platform', false))
      setBooted(true)
    })()
    return () => { alive = false }
  }, [setPause])

  // Меню на экране и кнопки работают — сообщаем Яндексу, что игра загрузилась
  useEffect(() => {
    if (booted) gameReady()
  }, [booted])

  // Свернули вкладку или переключились — пауза
  useEffect(() => {
    const onVis = () => setPause('hidden', document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [setPause])

  // Тишина на любой паузе
  useEffect(() => {
    setSuspended(paused)
  }, [paused])

  // Разметка геймплея для Яндекса: идёт только сама смена и только без паузы
  useEffect(() => {
    if (booted && state.phase === 'shift' && !paused) gameplayStart()
    else gameplayStop()
  }, [booted, state.phase, paused])

  const adHooks: AdHooks = {
    onStart: () => setPause('ad', true),
    onEnd: () => setPause('ad', false),
  }

  useEffect(() => {
    setMuted(muted)
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* без хранилища — не страшно */ }
  }, [muted])

  // Сохраняем всё, кроме середины смены. При смене экрана — сразу и в облако
  const lastPhase = useRef(state.phase)
  useEffect(() => {
    if (!booted || state.phase === 'shift') return
    const phaseChanged = lastPhase.current !== state.phase
    lastPhase.current = state.phase
    writeSave(saveOf(state), phaseChanged)
  }, [state, booted])

  // Игровой цикл. Пауза, когда вкладка скрыта — этого требует модерация Яндекс Игр
  useEffect(() => {
    if (state.phase !== 'shift') return
    let last = performance.now()
    let raf = 0
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      if (!document.hidden && !pausedRef.current) dispatch({ type: 'tick', dt })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [state.phase])

  // Эффекты из логики: звук, всплывающие деньги, тряска при ошибке
  useEffect(() => {
    for (const f of state.fx) {
      if (seenFx.current.has(f.id)) continue
      seenFx.current.add(f.id)
      play(f.kind)
      buzz(f.kind)
      if (f.kind === 'error') setShake(s => s + 1)
      if (f.text) {
        const fl: Floater = { id: f.id, text: f.text, tone: f.kind === 'error' ? 'bad' : 'good' }
        setFloaters(list => [...list, fl])
        setTimeout(() => setFloaters(list => list.filter(x => x.id !== fl.id)), 1100)
      }
      dispatch({ type: 'dropFx', id: f.id })
    }
  }, [state.fx])

  useEffect(() => {
    const timers = state.toasts.map(t => setTimeout(() => dispatch({ type: 'dropToast', id: t.id }), 1800))
    return () => timers.forEach(clearTimeout)
  }, [state.toasts])

  // Клавиатура: цифры, Backspace, Enter — терминал; пробел — пробить выдачу
  useEffect(() => {
    if (state.phase !== 'shift') return
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { click(); dispatch({ type: 'key', digit: e.key }) }
      else if (e.key === 'Backspace') { click(); dispatch({ type: 'backspace' }) }
      else if (e.key === 'Enter') dispatch({ type: 'submitCode' })
      else if (e.key === ' ') { e.preventDefault(); dispatch({ type: 'handOver' }) }
      else if (e.key === 'Escape') dispatch({ type: 'closeCell' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.phase])

  if (!booted) {
    return (
      <div className="app">
        <main className="stage stage-scroll">
          <section className="panel loading"><p className="eyebrow">Пункт выдачи «Коробка»</p><h1>Смена на ПВЗ</h1><p className="hint">Открываем пункт…</p></section>
        </main>
      </div>
    )
  }

  return (
    <div className={`app app-${state.phase}`}>
      <Hud state={state} muted={muted} onMute={() => setMutedState(m => !m)} />
      <main className={`stage ${state.phase === 'shift' ? 'stage-fit' : 'stage-scroll'}`}>
        {state.phase === 'menu' && <Menu state={state} dispatch={dispatch} onStart={() => { play('beep'); dispatch({ type: 'start' }) }} />}
        {state.phase === 'shift' && (
          <FitToScreen>
            <ShiftView state={state} dispatch={dispatch} floaters={floaters} shake={shake} />
          </FitToScreen>
        )}
        {state.phase === 'dayEnd' && <DayEnd state={state} dispatch={dispatch} adHooks={adHooks} />}
        {state.phase === 'shop' && <Shop state={state} dispatch={dispatch} />}
        {state.phase === 'map' && <NetworkMap state={state} dispatch={dispatch} />}
      </main>
      <div className="toasts" aria-live="polite">
        {state.toasts.map(t => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
      </div>
    </div>
  )
}

// ---------- Шапка ----------

function Hud({ state, muted, onMute }: { state: GameState; muted: boolean; onMute: () => void }) {
  const shift = state.shift
  const shown = state.money + (shift?.earned ?? 0)
  return (
    <header className="hud">
      <div className="hud-brand">
        <span className="brand-mark">ПВЗ</span>
        <span className="brand-day">
          {DISTRICTS[state.district].icon}<span className="brand-district"> {DISTRICTS[state.district].name} ·</span> смена №{state.day}
        </span>
      </div>
      <div className="hud-stats">
        <span className="stars" aria-label={`Рейтинг ${state.rating.toFixed(1)} из 5`}>★ <b>{state.rating.toFixed(1)}</b></span>
        <span className="money">{shown.toLocaleString('ru-RU')} ₽</span>
        <button className="mute" onClick={onMute} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>{muted ? '🔇' : '🔊'}</button>
        <FullscreenButton />
      </div>
      {shift && (
        <div className="timer" aria-label={`До конца смены ${Math.ceil(shift.timeLeft)} секунд`}>
          <div className="timer-fill" style={{ width: `${(shift.timeLeft / SHIFT_SECONDS) * 100}%` }} />
          <span className="timer-text">{Math.ceil(shift.timeLeft)} с</span>
        </div>
      )}
    </header>
  )
}

// ---------- Меню ----------

// Сброс прогресса с подтверждением прямо на странице (системные confirm() в играх не работают)
function ResetProgress({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const [asking, setAsking] = useState(false)
  const fresh = state.day === 1 && state.money === 0 && Object.values(state.upgrades).every(v => v === 0)
  if (fresh) return null
  if (!asking) {
    return <button className="link-btn" onClick={() => setAsking(true)}>Сбросить прогресс</button>
  }
  return (
    <div className="reset-confirm" role="alertdialog" aria-label="Подтверждение сброса">
      <p>Начать с первой смены? Деньги, рейтинг и все улучшения пропадут. Отменить это нельзя.</p>
      <div className="reset-actions">
        <button className="btn btn-danger" onClick={() => { dispatch({ type: 'reset' }); setAsking(false) }}>Да, сбросить</button>
        <button className="btn" onClick={() => setAsking(false)}>Отмена</button>
      </div>
    </div>
  )
}

// Звание и прогресс до следующего
function RankBar({ state }: { state: GameState }) {
  const r = rankOf(state.totalServed)
  const next = RANKS[r + 1]
  const from = RANKS[r].at
  const share = next ? (state.totalServed - from) / (next.at - from) : 1
  return (
    <div className="rank" aria-label={`Звание: ${RANKS[r].title}`}>
      <div className="rank-row">
        <span className="rank-title">{RANKS[r].title}</span>
        <span className="rank-next">{next ? `до «${next.title}»: ${next.at - state.totalServed} заказов` : 'Высшее звание'}</span>
      </div>
      <div className="rank-bar"><i style={{ transform: `scaleX(${share})` }} /></div>
    </div>
  )
}

// Задания на ближайшую смену (до её начала прогресса нет)
function TaskList({ state }: { state: GameState }) {
  if (!state.tasks.length) {
    return <p className="hint">Задания появятся после первой смены.</p>
  }
  return (
    <div className="tasks">
      <p className="tasks-title">Задания на смену</p>
      <ul>
        {state.tasks.map(t => (
          <li key={t.id}><span>{taskTitle(t)}</span><b>+{t.reward} ₽</b></li>
        ))}
      </ul>
    </div>
  )
}

function Menu({ state, dispatch, onStart }: { state: GameState; dispatch: Dispatch; onStart: () => void }) {
  const crew = [CHARACTERS[0], CHARACTERS[4], CHARACTERS[7], CHARACTERS[5]]
  return (
    <section className="panel menu">
      <div className="menu-crowd" aria-hidden="true">
        {crew.map((c, i) => <Avatar key={c.name} look={c.look} mood={i === 1 ? 'happy' : i === 2 ? 'tense' : 'calm'} size={78} />)}
      </div>
      <p className="eyebrow">Пункт выдачи «Коробка»</p>
      <h1>Смена на ПВЗ</h1>
      <RankBar state={state} />
      <details className="rules-box" open={state.day === 1}>
        <summary>Как играть</summary>
        <ol className="rules">
          <li>Клиент диктует код — вбей его в терминал.</li>
          <li>Терминал покажет ячейки. Открой ячейку и выбери коробку с нужным кодом — там лежат похожие.</li>
          <li>Всё собрано — пробей выдачу. Быстро работаешь — больше чаевых.</li>
          <li>Кто-то придёт не за посылкой, а поговорить. Отвечай с умом.</li>
        </ol>
        <p className="hint">На компьютере код можно набирать с клавиатуры, Enter — найти, пробел — выдать.</p>
      </details>
      <TaskList state={state} />
      <div className="menu-actions">
        <button className="btn btn-primary" onClick={onStart}>
          {state.day > 1 ? `Открыть смену №${state.day}` : 'Открыть пункт'}
        </button>
        <button className="btn" onClick={() => dispatch({ type: 'openShop' })}>
          Улучшения · {state.money.toLocaleString('ru-RU')} ₽
        </button>
        <button className="btn" onClick={() => dispatch({ type: 'openMap' })}>
          Сеть пунктов · {state.owned.length}/{DISTRICT_ORDER.length}
        </button>
      </div>
      <ResetProgress state={state} dispatch={dispatch} />
    </section>
  )
}

// ---------- Смена ----------

type ShiftProps = { state: GameState; dispatch: Dispatch; floaters: Floater[]; shake: number }

function ShiftView({ state, dispatch, floaters, shake }: ShiftProps) {
  const shift = state.shift!
  return (
    <div className="shift">
      <EventBar shift={shift} />
      <TaskStrip state={state} />
      <div className="work">
        <Counter state={state} dispatch={dispatch} floaters={floaters} shake={shake} />
        <Terminal state={state} dispatch={dispatch} />
      </div>
      <div className="storage">
        {shift.unloading.length > 0 && <Unloading shift={shift} dispatch={dispatch} />}
        <Rack state={state} dispatch={dispatch} />
      </div>
    </div>
  )
}

// Задания во время смены: компактные плашки с прогрессом
function TaskStrip({ state }: { state: GameState }) {
  const shift = state.shift!
  if (!state.tasks.length) return null
  const stats = statsOf(shift)
  return (
    <div className="taskstrip" aria-label="Задания">
      {state.tasks.map(t => {
        const [have, need] = taskProgress(t, stats)
        const done = taskDone(t, stats)
        const failed = taskFailed(t, stats)
        return (
          <span key={t.id} className={`chip ${done ? 'chip-done' : failed ? 'chip-failed' : ''}`}>
            <span className="chip-text">{taskTitle(t)}</span>
            <b>{done ? '✓' : failed ? '✗' : t.kind === 'noLost' ? '…' : `${Math.min(have, need).toLocaleString('ru-RU')}/${need.toLocaleString('ru-RU')}`}</b>
          </span>
        )
      })}
    </div>
  )
}

function EventBar({ shift }: { shift: Shift }) {
  const event = shift.active
  if (!event) {
    return (
      <section className="event event-calm" role="status">
        <span className="event-icon" aria-hidden="true">📻</span>
        <div className="event-text">
          <p className="event-title">Спокойно</p>
          <p className="event-desc">{shift.schedule.length ? 'Пока всё тихо. Но смена ещё не кончилась.' : 'Сюрпризов сегодня больше не будет.'}</p>
        </div>
      </section>
    )
  }
  const info = EVENTS[event.kind]
  return (
    <section className={`event event-${event.kind}`} role="status" key={event.kind}>
      <span className="event-icon" aria-hidden="true">{info.icon}</span>
      <div className="event-text">
        <p className="event-title">{info.title}</p>
        <p className="event-desc">{info.announce}</p>
      </div>
      <span className="event-time">{Math.ceil(event.timeLeft)} с</span>
      <i className="event-bar" style={{ transform: `scaleX(${event.timeLeft / info.duration})` }} />
    </section>
  )
}

function Counter({ state, dispatch, floaters, shake }: ShiftProps) {
  const shift = state.shift!
  const dep = shift.departing
  const front = shift.queue[0]
  const shown = dep ? dep.client : front
  const mood = dep ? dep.mood : front ? moodOf(front) : 'calm'
  const ratio = front && !dep ? front.patience / front.maxPatience : 0
  // Сколько мест в заказе — считаем по полкам и стойке, терминал для этого не нужен
  const total = front?.kind === 'pickup' ? shift.counter.length + shift.parcels.filter(p => p.code === front.code).length : 0
  const allCollected = shift.counter.length > 0 && shift.counter.length === total
  const dark = isBlackout(shift)

  return (
    <section className={`counter ${shake ? `shake-${shake % 2}` : ''}`} aria-label="Стойка выдачи">
      <div className="wall" aria-hidden="true">
        <span className="wall-sign">Выдача заказов</span>
        <span className="wall-hours">ПН–ВС 9:00–21:00</span>
      </div>

      {shown ? (
        <div className={`client ${dep ? `leaving leaving-${dep.mood}` : 'arriving'}`} key={shown.id}>
          <div className="client-figure">
            <Avatar look={shown.look} mood={mood} size={112} title={shown.name} />
          </div>
          <div className="bubble">
            <p className="bubble-name">{shown.name}</p>
            <p className="bubble-line">«{dep ? dep.line : shown.line}»</p>
            {!dep && shown.kind === 'pickup' && (
              <p className="bubble-code" aria-label={`Код ${shown.code}`}>
                {shown.code}
                {dark && <span className="bubble-places">мест: {total}</span>}
              </p>
            )}
            {!dep && (
              <div className={`patience patience-${moodOf(shown)}`} aria-label="Терпение клиента">
                <i style={{ transform: `scaleX(${ratio})` }} />
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="empty">Очереди нет. Можно выдохнуть.</p>
      )}

      <div className="queue" aria-label={`В очереди: ${Math.max(0, shift.queue.length - (dep ? 0 : 1))}`}>
        {shift.queue.slice(dep ? 0 : 1).map(c => (
          <span key={c.id} className="queue-person" title={c.name}>
            <Avatar look={c.look} mood={moodOf(c)} size={34} />
          </span>
        ))}
        {Array.from({ length: Math.max(0, MAX_QUEUE - 1 - shift.queue.slice(dep ? 0 : 1).length) }, (_, i) => <span key={i} className="queue-slot" />)}
      </div>

      <div className="desk">
        <div className="desk-boxes">
          {shift.counter.map(p => <span key={p.id} className="desk-box" style={{ ['--tone' as string]: p.tone }} />)}
        </div>
        {shift.counter.length > 0 && !dep && (
          <button className={`btn btn-scan ${allCollected ? 'ready' : ''}`} onClick={() => dispatch({ type: 'handOver' })}>
            {allCollected ? 'Пробить выдачу' : `Собрано ${shift.counter.length} из ${total}`}
          </button>
        )}
      </div>

      <div className="floaters" aria-hidden="true">
        {floaters.map(f => <span key={f.id} className={`floater floater-${f.tone}`}>{f.text}</span>)}
      </div>
    </section>
  )
}

function Terminal({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const shift = state.shift!
  const front = shift.departing ? null : shift.queue[0]

  const press = useCallback((d: string) => { click(); dispatch({ type: 'key', digit: d }) }, [dispatch])

  // Разговорный клиент: вместо терминала — варианты ответа
  if (front?.kind === 'talk' && front.situation) {
    return (
      <section className="terminal terminal-talk" aria-label="Ответ клиенту">
        <p className="terminal-label">Что ответить?</p>
        <div className="answers">
          {front.situation.options.map((o, i) => (
            <button key={i} className="btn btn-answer" onClick={() => dispatch({ type: 'answer', index: i })}>{o.label}</button>
          ))}
        </div>
      </section>
    )
  }

  const lookup = shift.lookup
  const remaining = lookup ? new Set(shift.parcels.filter(p => p.code === lookup.code).map(p => p.cell)) : new Set<number>()
  const off = isBlackout(shift)

  return (
    <section className={`terminal ${shift.lookupError ? 'terminal-error' : ''} ${off ? 'terminal-off' : ''}`} aria-label="Терминал">
      <div className="screen">
        {off ? (
          <>
            <p className="screen-top">НЕТ ПИТАНИЯ</p>
            <p className="screen-sub">Ищи коробку с кодом клиента фонариком и бери прямо со стеллажа</p>
          </>
        ) : lookup ? (
          <>
            <p className="screen-top">ЗАКАЗ {lookup.code} · {lookup.item}</p>
            <p className="screen-main">
              {lookup.cells.map(c => (
                <span key={c} className={remaining.has(c) ? 'cell-tag' : 'cell-tag done'}>{String(c + 1).padStart(2, '0')}</span>
              ))}
            </p>
            <p className="screen-sub">
              {remaining.size ? `Мест: ${lookup.boxes}. Забери коробки из ячеек` : 'Всё на стойке — пробей выдачу'}
            </p>
          </>
        ) : (
          <>
            <p className="screen-top">{shift.lookupError ? 'ЗАКАЗ НЕ НАЙДЕН' : front?.kind === 'pickup' ? 'ВВЕДИТЕ КОД КЛИЕНТА' : 'ОЖИДАНИЕ КЛИЕНТА'}</p>
            <p className="screen-main digits">
              {[0, 1, 2, 3].map(i => <span key={i} className="digit">{shift.input[i] ?? '·'}</span>)}
            </p>
          </>
        )}
      </div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
          <button key={d} className="key" onClick={() => press(d)} disabled={!!lookup || off}>{d}</button>
        ))}
        <button className="key key-fn" onClick={() => { click(); dispatch({ type: 'backspace' }) }} disabled={!!lookup || off} aria-label="Стереть">⌫</button>
        <button className="key" onClick={() => press('0')} disabled={!!lookup || off}>0</button>
        <button className="key key-ok" onClick={() => dispatch({ type: 'submitCode' })} disabled={!!lookup || off || shift.input.length < 4}>OK</button>
      </div>
      {state.upgrades.qr > 0 && (
        <button className="btn btn-qr" onClick={() => dispatch({ type: 'scanQr' })} disabled={!!lookup || off || front?.kind !== 'pickup'}>
          📟 Сканировать QR клиента
        </button>
      )}
    </section>
  )
}

function Unloading({ shift, dispatch }: { shift: Shift; dispatch: Dispatch }) {
  return (
    <section className="unloading" aria-label="Разгрузка">
      <p className="unloading-title">Разгрузка: осталось {shift.unloading.length}. Нажимай на коробки, чтобы убрать их на полки</p>
      <div className="unloading-boxes">
        {shift.unloading.map(p => (
          <button key={p.id} className="crate" style={{ ['--tone' as string]: p.tone }} onClick={() => dispatch({ type: 'placeParcel', parcelId: p.id })} aria-label="Убрать коробку на полку">
            <span className="crate-tape" />
          </button>
        ))}
      </div>
    </section>
  )
}

function Rack({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const shift = state.shift!
  const dark = isBlackout(shift)
  const lookup = shift.lookup
  const want = state.upgrades.shelf && lookup
    ? new Set(shift.parcels.filter(p => p.code === lookup.code).map(p => p.cell))
    : new Set<number>()

  const ref = useRef<HTMLDivElement>(null)
  const moveLight = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--lx', `${e.clientX - r.left}px`)
    el.style.setProperty('--ly', `${e.clientY - r.top}px`)
  }

  const boxesIn = (cell: number) => shift.parcels.filter(p => p.cell === cell)
  const open = shift.openCell

  return (
    <section
      ref={ref}
      className={`rack ${dark ? 'rack-dark' : ''}`}
      aria-label="Стеллаж"
      onPointerMove={dark ? moveLight : undefined}
      onPointerDown={dark ? moveLight : undefined}
    >
      {Array.from({ length: CELLS }, (_, i) => {
        const cat = shift.catCell === i && shift.active?.kind === 'cat'
        const num = <span className="cell-num">{String(i + 1).padStart(2, '0')}</span>

        // Без света: коды напечатаны на коробках, берём прямо с полки
        if (dark) {
          return (
            <div key={i} className="cell cell-dark">
              {num}
              <span className="cell-boxes">
                {boxesIn(i).map(p => (
                  <button key={p.id} className="stack-box stack-label" style={{ ['--tone' as string]: p.tone }} onClick={() => dispatch({ type: 'takeBox', parcelId: p.id })}>
                    {p.code}
                  </button>
                ))}
              </span>
            </div>
          )
        }

        return (
          <button
            key={i}
            className={`cell ${want.has(i) ? 'cell-want' : ''} ${cat ? 'cell-cat' : ''} ${open === i ? 'cell-open' : ''}`}
            onClick={() => dispatch({ type: 'tapCell', cell: i })}
            aria-label={`Ячейка ${i + 1}`}
          >
            {num}
            <span className="cell-boxes">
              {cat && <span className="stack-box stack-cat">мяу</span>}
              {boxesIn(i).map(p => <span key={p.id} className="stack-box" style={{ ['--tone' as string]: p.tone }} />)}
            </span>
          </button>
        )
      })}

      {open !== null && !dark && <CellView cell={open} shift={shift} dispatch={dispatch} />}
      {dark && <div className="flashlight" aria-hidden="true" />}
    </section>
  )
}

// Открытая ячейка: коробки с наклейками, нужно выбрать ту, у которой код совпадает
function CellView({ cell, shift, dispatch }: { cell: number; shift: Shift; dispatch: Dispatch }) {
  const boxes = shift.parcels.filter(p => p.cell === cell)
  return (
    <div className="cellview" role="dialog" aria-label={`Ячейка ${cell + 1}`}>
      <div className="cellview-head">
        <span className="cellview-title">Ячейка {String(cell + 1).padStart(2, '0')}</span>
        <span className="cellview-hint">Найди коробку с кодом клиента</span>
        <button className="cellview-close" onClick={() => dispatch({ type: 'closeCell' })} aria-label="Закрыть ячейку">✕</button>
      </div>
      <div className="cellview-boxes">
        {boxes.map(p => (
          <button key={p.id} className="label-box" style={{ ['--tone' as string]: p.tone }} onClick={() => dispatch({ type: 'takeBox', parcelId: p.id })}>
            <span className="label">
              <span className="label-bars" aria-hidden="true" />
              <span className="label-code">{p.code}</span>
              <span className="label-cell">яч. {String(cell + 1).padStart(2, '0')}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Конец дня ----------

function DayEnd({ state, dispatch, adHooks }: { state: GameState; dispatch: Dispatch; adHooks: AdHooks }) {
  const r = state.result!
  const [watching, setWatching] = useState(false)
  const busy = useRef(false)

  const double = async () => {
    if (busy.current) return
    busy.current = true
    setWatching(true)
    const ok = await showRewarded(adHooks)
    setWatching(false)
    busy.current = false
    if (ok) dispatch({ type: 'doubleReward' })
  }

  // Полноэкранная реклама — в логической паузе между отчётом и улучшениями (п. 4.4).
  // С первой смены не показываем, чтобы новичок сначала втянулся. Частоту ограничивает сам Яндекс.
  const next = async () => {
    if (busy.current) return
    busy.current = true
    if (state.day >= 2 && !r.doubled) await showFullscreen(adHooks)
    busy.current = false
    dispatch({ type: 'openShop' })
  }

  const good = r.lost === 0 && r.mistakes <= 1
  return (
    <section className="panel receipt">
      <div className="receipt-head">
        <div>
          <p className="eyebrow">Закрытие смены №{state.day}</p>
          <h2>{good ? 'Отличная смена' : r.lost > 2 ? 'Тяжёлый день' : 'Смена закрыта'}</h2>
        </div>
        <Avatar look={CHARACTERS[0].look} mood={good ? 'happy' : r.lost > 2 ? 'angry' : 'calm'} size={64} />
      </div>
      <dl className="receipt-lines">
        <div><dt>Выдано заказов</dt><dd>{r.served}</dd></div>
        <div><dt>Разговоров</dt><dd>{r.talked}</dd></div>
        <div><dt>Ошибок</dt><dd>{r.mistakes}</dd></div>
        <div><dt>Ушли ни с чем</dt><dd>{r.lost}</dd></div>
        {r.events.map((e, i) => <div key={i} className="receipt-event"><dt>{e}</dt><dd /></div>)}
        <div className="receipt-total"><dt>Выручка</dt><dd>{(r.earned * (r.doubled ? 2 : 1)).toLocaleString('ru-RU')} ₽</dd></div>
      </dl>
      {r.tasks.length > 0 && (
        <div className="tasks tasks-result">
          <p className="tasks-title">Задания · +{r.taskMoney.toLocaleString('ru-RU')} ₽</p>
          <ul>
            {r.tasks.map((t, i) => (
              <li key={i} className={t.done ? 'done' : 'failed'}>
                <span>{t.done ? '✓' : '✗'} {t.title}</span><b>{t.done ? `+${t.reward} ₽` : '—'}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.rankUp && (
        <div className="rankup" role="status">
          <span className="rankup-label">Повышение!</span>
          <span className="rankup-title">{r.rankUp}</span>
          <NewDistrictHint state={state} />
        </div>
      )}
      <div className="receipt-actions">
        {!r.doubled && r.earned > 0 && (
          <button className="btn btn-ad" onClick={double} disabled={watching}>
            {watching ? 'Смотрим рекламу…' : '×2 выручки за рекламу'}
          </button>
        )}
        <button className="btn btn-primary" onClick={next} disabled={watching}>К улучшениям</button>
      </div>
    </section>
  )
}

// Что открыло новое звание
function NewDistrictHint({ state }: { state: GameState }) {
  const r = rankOf(state.totalServed)
  const d = DISTRICT_ORDER.map(id => DISTRICTS[id]).find(x => x.rank === r)
  if (!d) return null
  return <span className="rankup-hint">Теперь можно открыть точку: {d.icon} {d.name}</span>
}

// ---------- Сеть пунктов ----------

function NetworkMap({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const rank = rankOf(state.totalServed)
  return (
    <section className="panel map">
      <p className="eyebrow">Сеть пунктов · {RANKS[rank].title}</p>
      <h2>Твои точки</h2>
      <p className="hint">У каждой точки свои улучшения. Задания и звание — общие.</p>
      <div className="districts">
        {DISTRICT_ORDER.map((id: DistrictId) => {
          const d = DISTRICTS[id]
          const owned = state.owned.includes(id)
          const current = state.district === id
          const rankOk = rank >= d.rank
          return (
            <article key={id} className={`district ${current ? 'district-current' : ''} ${!owned ? 'district-locked' : ''}`}>
              <span className="district-icon" aria-hidden="true">{d.icon}</span>
              <div className="district-body">
                <p className="district-name">{d.name}</p>
                <p className="district-pitch">{d.pitch}</p>
                <p className="district-traits">{d.traits.map(t => <span key={t}>{t}</span>)}</p>
              </div>
              <div className="district-action">
                {current ? (
                  <span className="district-here">Ты здесь</span>
                ) : owned ? (
                  <button className="btn btn-small" onClick={() => dispatch({ type: 'selectDistrict', id })}>Перейти</button>
                ) : !rankOk ? (
                  <span className="district-need">Нужно звание «{RANKS[d.rank].title}»</span>
                ) : (
                  <button className="btn btn-small" disabled={state.money < d.cost} onClick={() => dispatch({ type: 'buyDistrict', id })}>
                    Открыть · {d.cost.toLocaleString('ru-RU')} ₽
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
      <div className="menu-actions">
        <button className="btn btn-primary" onClick={() => { play('beep'); dispatch({ type: 'start' }) }}>
          Открыть смену: {DISTRICTS[state.district].name}
        </button>
        <button className="btn" onClick={() => dispatch({ type: 'openMenu' })}>В меню</button>
      </div>
    </section>
  )
}

// ---------- Улучшения ----------

function Shop({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const keys = Object.keys(UPGRADES) as (keyof Upgrades)[]
  return (
    <section className="panel shop">
      <p className="eyebrow">Перед сменой №{state.day}</p>
      <h2>Улучшить пункт</h2>
      <p className="hint">{DISTRICTS[state.district].icon} {DISTRICTS[state.district].name}: улучшения действуют только на этой точке.</p>
      <div className="upgrades">
        {keys.map(k => {
          const u = UPGRADES[k]
          const lvl = state.upgrades[k]
          const maxed = lvl >= u.max
          const cost = upgradeCost(k, lvl)
          return (
            <div key={k} className="upgrade">
              <span className="upgrade-icon" aria-hidden="true">{u.icon}</span>
              <div className="upgrade-text">
                <p className="upgrade-title">{u.title} <span className="lvl">{lvl}/{u.max}</span></p>
                <p className="upgrade-desc">{u.describe(maxed ? lvl : lvl + 1)}</p>
              </div>
              <button className="btn btn-small" disabled={maxed || state.money < cost} onClick={() => dispatch({ type: 'buy', key: k })}>
                {maxed ? 'Макс.' : `${cost.toLocaleString('ru-RU')} ₽`}
              </button>
            </div>
          )
        })}
      </div>
      <div className="menu-actions">
        <button className="btn btn-primary" onClick={() => { play('beep'); dispatch({ type: 'start' }) }}>Открыть смену №{state.day}</button>
        <button className="btn" onClick={() => dispatch({ type: 'openMenu' })}>В меню</button>
      </div>
      <ResetProgress state={state} dispatch={dispatch} />
    </section>
  )
}
