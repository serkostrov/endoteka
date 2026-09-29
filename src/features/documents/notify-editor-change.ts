import type { Editor as TinyMCEEditor } from 'tinymce'

/**
 * Сообщает tinymce-react об изменении контента после программных правок
 * (отступы, свойства таблицы, интервал). Без `change` controlled `value` остаётся старым
 * и «Сохранить» пишет прошлую разметку.
 *
 * Перед событием лучше вызвать syncMceInlineStyle на изменённых узлах —
 * иначе getContent() может вернуть устаревший data-mce-style.
 */
export function notifyEditorContentChanged(editor: TinyMCEEditor) {
  editor.setDirty(true)
  // tinymce-react слушает: change keyup compositionend setcontent CommentChange
  editor.dispatch('change')
  editor.dispatch('input')
  editor.nodeChanged()
}
