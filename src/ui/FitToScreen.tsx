// Вписывает смену в экран без прокрутки (п. 1.10 требований Яндекс Игр).
// Содержимое верстается в свой обычный размер, а если не влезает по высоте или ширине —
// уменьшается целиком, как картинка. Так на любом экране всё видно и ничего не обрезано.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const MIN_SCALE = 0.3

export function FitToScreen({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    const fit = () => {
      // transform не меняет раскладку, поэтому scrollHeight — это «настоящая» высота
      const s = Math.min(1, o.clientHeight / i.scrollHeight, o.clientWidth / i.scrollWidth)
      setScale(Math.max(MIN_SCALE, Math.floor(s * 100) / 100))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={outer} className="fit">
      <div ref={inner} className="fit-inner" style={{ transform: scale < 1 ? `scale(${scale})` : undefined }}>
        {children}
      </div>
    </div>
  )
}
