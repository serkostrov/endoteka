import { DOCUMENT_HTML_BODY_STYLE, documentMarginsPadding } from './document-content-style'
import type { PageMarginsMm } from './template-schema'

type PaginateOptions = {
  pageSize: 'a4' | 'label'
  margins: PageMarginsMm
}

/**
 * Делит HTML на страницы по высоте листа.
 * Короткие заголовки не отрываются от следующего блока (keep-with-next).
 */
export function paginateDocumentHtml(html: string, options: PaginateOptions): string[] {
  if (typeof document === 'undefined') {
    return [html]
  }

  if (options.pageSize === 'label') {
    return [html]
  }

  const { margins } = options
  const host = document.createElement('div')
  host.setAttribute('data-doc-paginate-host', '1')
  host.style.cssText =
    'position:fixed;left:-14000px;top:0;width:210mm;pointer-events:none;visibility:hidden;z-index:-1;'

  const style = document.createElement('style')
  style.textContent = DOCUMENT_HTML_BODY_STYLE

  const page = document.createElement('div')
  page.className = 'document-html-body'
  page.style.cssText = [
    'box-sizing:border-box',
    'width:210mm',
    `padding:${documentMarginsPadding(margins)}`,
    'background:#fff',
    'color:#000',
  ].join(';')
  page.innerHTML = html

  host.append(style, page)
  document.body.appendChild(host)

  try {
    const pageH = mmToPx(host, 297)
    const padTop = mmToPx(host, margins.top)
    const padBottom = mmToPx(host, margins.bottom)
    // Небольшой запас: измерение и печать чуть отличаются (Safari)
    const usableH = Math.max(48, (pageH - padTop - padBottom) * 0.96)

    const children = [...page.children] as HTMLElement[]
    if (children.length === 0) {
      return [html]
    }

    const pages: HTMLElement[][] = [[]]
    let pageOriginTop = children[0]?.offsetTop ?? 0

    for (const child of children) {
      const top = child.offsetTop
      const height = child.offsetHeight
      const relBottom = top + height - pageOriginTop
      const current = pages[pages.length - 1]!

      if (current.length > 0 && relBottom > usableH + 0.5) {
        if (height <= usableH + 0.5) {
          // Новый лист; забираем короткий заголовок с конца предыдущего
          const moved: HTMLElement[] = [child]
          while (current.length > 0 && isKeepWithNext(current[current.length - 1]!)) {
            moved.unshift(current.pop()!)
          }
          pages.push(moved)
          pageOriginTop = moved[0]?.offsetTop ?? top
        } else {
          current.push(child)
          pages.push([])
          pageOriginTop = top + height
        }
      } else {
        current.push(child)
      }
    }

    const result = pages
      .filter((group) => group.length > 0)
      .map((group) => group.map((el) => el.outerHTML).join(''))

    return result.length > 0 ? result : [html]
  } finally {
    host.remove()
  }
}

/** Короткий заголовок — держим со следующим блоком. */
function isKeepWithNext(el: HTMLElement) {
  const tag = el.tagName
  if (tag !== 'P' && tag !== 'H1' && tag !== 'H2' && tag !== 'H3' && tag !== 'H4') {
    return false
  }
  const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  if (!text || text.length > 100) {
    return false
  }
  return el.offsetHeight < 64
}

function mmToPx(host: HTMLElement, mm: number) {
  const probe = document.createElement('div')
  probe.style.cssText = `position:absolute;visibility:hidden;height:${mm}mm;`
  host.appendChild(probe)
  const px = probe.getBoundingClientRect().height
  probe.remove()
  return px || mm * 3.7795
}
