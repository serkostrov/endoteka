/**
 * TinyMCE при getContent() отдаёт `data-mce-style`, а не живой `style`.
 * Правки через CSSOM / setAttribute('style') без синка — сохраняются старые отступы.
 */
export function syncMceInlineStyle(el: HTMLElement) {
  // cssText — актуальные longhands после setProperty; атрибут мог отстать
  const fromCss = (el.style.cssText || '').trim()
  const fromAttr = (el.getAttribute('style') || '').trim()
  const raw = fromCss || fromAttr
  const value = raw
    .replace(/\s*;\s*/g, '; ')
    .replace(/;\s*$/, '')
    .trim()
  if (value) {
    el.setAttribute('style', value)
    el.setAttribute('data-mce-style', value)
  } else {
    el.removeAttribute('style')
    el.removeAttribute('data-mce-style')
  }
}
