import type { Editor as TinyMCEEditor } from 'tinymce'

const DOC_TOKEN_SELECTOR = '.doc-field, .doc-barcode, .doc-qr'

/**
 * Поля .doc-field без contenteditable=false — иначе браузер не даёт
 * выделить обычный текст и поле одним диапазоном (форматирование «либо/либо»).
 * Правку текста внутри поля блокируем; печать/Enter — вставка сразу после поля,
 * иначе на этикетке (почти сплошь поля) нельзя ничего написать.
 *
 * Enter у штрихкода/QR/поля не должен сплиттить блок или продолжать .doc-field
 * (иначе клонируется штрихкод / новая строка остаётся с синей подложкой поля).
 */
export function registerDocFieldGuards(editor: TinyMCEEditor) {
  /** keydown уже обработал ввод — beforeinput не должен дублировать. */
  let insertedFromKeydown = false

  editor.on('click', (event) => {
    const field = fieldFromEventTarget(event.target)
    if (!field || event.shiftKey) {
      return
    }
    // Клик без протяжки — выделить поле целиком (удобно удалить / применить стиль).
    if (!editor.selection.isCollapsed()) {
      return
    }
    editor.selection.select(field)
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    const key = event.key
    if (
      key === 'ArrowLeft' ||
      key === 'ArrowRight' ||
      key === 'ArrowUp' ||
      key === 'ArrowDown' ||
      key === 'Home' ||
      key === 'End' ||
      key === 'PageUp' ||
      key === 'PageDown' ||
      key === 'Escape' ||
      key === 'Tab' ||
      key === 'Shift'
    ) {
      return
    }

    const around = tokenAroundCaret(editor)
    const adjacent = around ? null : tokenAdjacentToCaret(editor)
    const token = around ?? adjacent?.token
    if (!token) {
      return
    }

    if (key === 'Backspace' || key === 'Delete') {
      // Удаляем токен только если каретка на нём / выделение — иначе обычное поведение у соседа.
      if (!around) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      editor.undoManager.transact(() => {
        editor.dom.remove(token)
      })
      editor.nodeChanged()
      return
    }

    if (key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      insertedFromKeydown = true
      insertCleanBreakAfterToken(editor, token)
      queueMicrotask(() => {
        insertedFromKeydown = false
      })
      return
    }

    // Печать — после токена, а не внутрь превью поля
    event.preventDefault()
    event.stopPropagation()
    placeCaretAfterToken(editor, token)

    if (key.length === 1 || key === ' ') {
      insertedFromKeydown = true
      editor.insertContent(key === ' ' ? ' ' : editor.dom.encode(key))
      queueMicrotask(() => {
        insertedFromKeydown = false
      })
    }
  }

  const onBeforeInput = (event: Event) => {
    if (insertedFromKeydown) {
      event.preventDefault()
      return
    }

    const inputEvent = event as InputEvent
    const around = tokenAroundCaret(editor)
    const adjacent = around ? null : tokenAdjacentToCaret(editor)
    const token = around ?? adjacent?.token
    if (!token) {
      return
    }
    const type = inputEvent.inputType || ''
    if (type.startsWith('history')) {
      return
    }

    if (type === 'deleteContentBackward' || type === 'deleteContentForward') {
      if (!around) {
        return
      }
      event.preventDefault()
      editor.undoManager.transact(() => {
        editor.dom.remove(token)
      })
      editor.nodeChanged()
      return
    }

    if (type === 'insertText' && inputEvent.data) {
      event.preventDefault()
      // Перенос из IME/автозамены не должен остаться внутри .doc-field
      if (inputEvent.data.includes('\n') || inputEvent.data.includes('\r')) {
        insertCleanBreakAfterToken(editor, token)
        return
      }
      placeCaretAfterToken(editor, token)
      editor.insertContent(editor.dom.encode(inputEvent.data))
      return
    }

    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault()
      insertCleanBreakAfterToken(editor, token)
      return
    }

    // Остальной ввод в превью поля не пускаем
    event.preventDefault()
  }

  // prepend — перехватить Enter до стандартного split TinyMCE
  editor.on('keydown', onKeyDown, true)

  editor.on('init', () => {
    editor.getBody()?.addEventListener('beforeinput', onBeforeInput, true)
  })
  editor.on('remove', () => {
    editor.getBody()?.removeEventListener('beforeinput', onBeforeInput, true)
  })
}

/** Убирает CEF с полей, чтобы выделение и форматирование работали вместе с текстом. */
export function unlockDocFieldsForSelection(root: ParentNode) {
  for (const el of root.querySelectorAll<HTMLElement>('.doc-field')) {
    el.removeAttribute('contenteditable')
    el.removeAttribute('data-mce-cef-wrappable')
    el.classList.remove('mceNonEditable')
  }
}

function fieldFromEventTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node)) {
    return null
  }
  const el = target instanceof HTMLElement ? target : target.parentElement
  return el?.closest('.doc-field') ?? null
}

function tokenAroundCaret(editor: TinyMCEEditor): HTMLElement | null {
  const node = editor.selection.getNode()
  if (node instanceof HTMLElement && node.matches(DOC_TOKEN_SELECTOR)) {
    return node
  }

  const rng = editor.selection.getRng()
  const start = closestDocToken(rng.startContainer)
  const end = closestDocToken(rng.endContainer)
  if (start && start === end) {
    return start
  }

  // Выделен весь токен (selection.select)
  if (!rng.collapsed) {
    const common = rng.commonAncestorContainer
    const el = common instanceof HTMLElement ? common : common.parentElement
    if (el?.matches(DOC_TOKEN_SELECTOR)) {
      return el
    }
    const wrapped = el?.closest(DOC_TOKEN_SELECTOR)
    if (wrapped instanceof HTMLElement && rng.toString() === (wrapped.textContent ?? '')) {
      return wrapped
    }
  }

  return null
}

/** Каретка сразу до/после токена (Enter иначе сплиттит блок и клонирует штрихкод). */
function tokenAdjacentToCaret(
  editor: TinyMCEEditor,
): { token: HTMLElement; side: 'before' | 'after' } | null {
  const rng = editor.selection.getRng()
  if (!rng.collapsed) {
    return null
  }

  const { startContainer, startOffset } = rng

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer as Text
    const len = text.textContent?.length ?? 0
    if (
      startOffset === 0 &&
      text.previousSibling instanceof HTMLElement &&
      text.previousSibling.matches(DOC_TOKEN_SELECTOR)
    ) {
      return { token: text.previousSibling, side: 'after' }
    }
    if (
      startOffset === len &&
      text.nextSibling instanceof HTMLElement &&
      text.nextSibling.matches(DOC_TOKEN_SELECTOR)
    ) {
      return { token: text.nextSibling, side: 'before' }
    }
    // Каретка в «хвосте» после токена (nbsp / пробелы)
    if (
      startOffset > 0 &&
      isCaretPaddingText(text.textContent) &&
      text.previousSibling instanceof HTMLElement &&
      text.previousSibling.matches(DOC_TOKEN_SELECTOR)
    ) {
      return { token: text.previousSibling, side: 'after' }
    }
  }

  if (startContainer instanceof Element) {
    const before = startContainer.childNodes[startOffset - 1]
    const after = startContainer.childNodes[startOffset]
    if (before instanceof HTMLElement && before.matches(DOC_TOKEN_SELECTOR)) {
      return { token: before, side: 'after' }
    }
    if (after instanceof HTMLElement && after.matches(DOC_TOKEN_SELECTOR)) {
      return { token: after, side: 'before' }
    }
    if (
      before?.nodeType === Node.TEXT_NODE &&
      isCaretPaddingText(before.textContent) &&
      before.previousSibling instanceof HTMLElement &&
      before.previousSibling.matches(DOC_TOKEN_SELECTOR)
    ) {
      return { token: before.previousSibling, side: 'after' }
    }
  }

  return null
}

function isCaretPaddingText(value: string | null | undefined) {
  if (!value) {
    return true
  }
  return /^[\u00a0\s]*$/.test(value)
}

function closestDocToken(node: Node | null): HTMLElement | null {
  if (!node) {
    return null
  }
  const el = node instanceof HTMLElement ? node : node.parentElement
  const found = el?.closest(DOC_TOKEN_SELECTOR)
  return found instanceof HTMLElement ? found : null
}

function placeCaretAfterToken(editor: TinyMCEEditor, token: HTMLElement) {
  const parent = token.parentNode
  if (!parent) {
    return
  }

  // Неразрывный пробел после токена — чтобы было куда поставить каретку
  let after = token.nextSibling
  if (!after || (after.nodeType === Node.TEXT_NODE && !after.textContent)) {
    after = editor.getDoc().createTextNode('\u00a0')
    parent.insertBefore(after, token.nextSibling)
  } else if (
    after instanceof HTMLElement &&
    after.matches(DOC_TOKEN_SELECTOR)
  ) {
    // Между токенами — вставляем точку для каретки
    after = editor.getDoc().createTextNode('\u00a0')
    parent.insertBefore(after, token.nextSibling)
  }

  const rng = editor.dom.createRng()
  if (after.nodeType === Node.TEXT_NODE) {
    rng.setStart(after, Math.min(1, after.textContent?.length ?? 0))
  } else {
    rng.setStartAfter(token)
  }
  rng.collapse(true)
  editor.selection.setRng(rng)
}

/**
 * Новая пустая строка после блока с токеном — без сплита поля/штрихкода.
 * Каретка уходит из .doc-field, новая строка без синей подложки.
 */
function insertCleanBreakAfterToken(editor: TinyMCEEditor, token: HTMLElement) {
  editor.undoManager.transact(() => {
    // Сначала выходим из токена — иначе br/Enter остаются внутри .doc-field
    placeCaretAfterToken(editor, token)

    const block = editor.dom.getParent(token, (node) => {
      if (!(node instanceof HTMLElement) || node === editor.getBody()) {
        return false
      }
      return editor.dom.isBlock(node)
    }) as HTMLElement | null

    const body = editor.getBody()
    if (!block || block === body) {
      const parent = token.parentNode
      if (!parent) {
        return
      }
      const br = editor.dom.create('br')
      parent.insertBefore(br, token.nextSibling)
      const pad = editor.getDoc().createTextNode('\u00a0')
      parent.insertBefore(pad, br.nextSibling)
      const rng = editor.dom.createRng()
      rng.setStart(pad, 0)
      rng.collapse(true)
      editor.selection.setRng(rng)
      removeOrphanTokenClones(token)
      return
    }

    // Новый абзац без классов поля — обычный текст
    const next = editor.getDoc().createElement('p')
    next.appendChild(editor.getDoc().createElement('br'))
    editor.dom.insertAfter(next, block)

    removeOrphanTokenClones(token)

    const rng = editor.dom.createRng()
    rng.setStart(next, 0)
    rng.collapse(true)
    editor.selection.setRng(rng)
    editor.nodeChanged()
  })
}

/** Убирает клоны токена и br внутри поля после неудачного split. */
function removeOrphanTokenClones(token: HTMLElement) {
  if (!token.isConnected) {
    return
  }

  // Enter внутри .doc-field мог вставить <br> — убираем, поле однострочное в превью
  if (token.classList.contains('doc-field') || token.classList.contains('doc-barcode') || token.classList.contains('doc-qr')) {
    for (const br of [...token.querySelectorAll('br')]) {
      br.remove()
    }
  }

  const parent = token.parentNode
  if (!parent) {
    return
  }

  const tokenText = (token.textContent ?? '').replace(/\u00a0/g, '').trim()
  for (const sibling of [...parent.childNodes]) {
    if (!(sibling instanceof HTMLElement) || sibling === token) {
      continue
    }
    if (!sibling.matches(DOC_TOKEN_SELECTOR)) {
      continue
    }

    const text = (sibling.textContent ?? '').replace(/\u00a0/g, '').trim()
    if (!text) {
      sibling.remove()
      continue
    }

    const sameField =
      Boolean(token.getAttribute('data-field')) &&
      sibling.getAttribute('data-field') === token.getAttribute('data-field')
    const sameCode =
      Boolean(token.getAttribute('data-code')) &&
      sibling.getAttribute('data-code') === token.getAttribute('data-code')

    if ((sameField || sameCode) && text === tokenText) {
      sibling.remove()
    }
  }
}
