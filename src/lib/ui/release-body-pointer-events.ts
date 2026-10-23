/**
 * Radix DropdownMenu/Select при закрытии иногда оставляет на body
 * `pointer-events: none` — UI «замирает», диалог не кликается.
 * Сбрасываем блокировку после открытия модалки / закрытия меню.
 */
export function releaseBodyPointerEvents() {
  if (typeof document === 'undefined') {
    return
  }
  document.body.style.pointerEvents = ''
}

/** Открыть модалку после закрытия меню, без залипания pointer-events. */
export function deferOpenModal(open: () => void) {
  window.setTimeout(() => {
    releaseBodyPointerEvents()
    open()
    window.requestAnimationFrame(() => {
      releaseBodyPointerEvents()
    })
  }, 0)
}
