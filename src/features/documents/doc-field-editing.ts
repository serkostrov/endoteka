import type { Editor as TinyMCEEditor } from 'tinymce'

/**
 * Поля .doc-field без contenteditable=false — иначе браузер не даёт
 * выделить обычный текст и поле одним диапазоном (форматирование «либо/либо»).
 * Правку текста внутри поля блокируем отдельно.
 */
export function registerDocFieldGuards(editor: TinyMCEEditor) {
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

  editor.on('keydown', (event) => {
    const field = fieldFullyContainingCaret(editor)
    if (!field) {
      return
    }

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

    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault()
      editor.undoManager.transact(() => {
        editor.dom.remove(field)
      })
      editor.nodeChanged()
      return
    }

    // Печать / Enter — не меняем текст превью поля
    event.preventDefault()
  })

  const onBeforeInput = (event: Event) => {
    const inputEvent = event as InputEvent
    const field = fieldFullyContainingCaret(editor)
    if (!field) {
      return
    }
    const type = inputEvent.inputType || ''
    if (type.startsWith('history')) {
      return
    }
    event.preventDefault()
  }

  editor.on('init', () => {
    editor.getBody()?.addEventListener('beforeinput', onBeforeInput)
  })
  editor.on('remove', () => {
    editor.getBody()?.removeEventListener('beforeinput', onBeforeInput)
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

function fieldFullyContainingCaret(editor: TinyMCEEditor): HTMLElement | null {
  const rng = editor.selection.getRng()
  const start = closestDocField(rng.startContainer)
  const end = closestDocField(rng.endContainer)
  if (!start || start !== end) {
    return null
  }
  return start
}

function closestDocField(node: Node | null): HTMLElement | null {
  if (!node) {
    return null
  }
  const el = node instanceof HTMLElement ? node : node.parentElement
  return el?.closest('.doc-field') ?? null
}
