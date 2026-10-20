/** Выбор шаблона этикетки на карточке склада (локально на устройстве). */
export const BUILTIN_ITEM_LABEL_TEMPLATE_ID = 'builtin'

const STORAGE_KEY = 'endoteka.item-label-template-id'

export function readItemLabelTemplatePreference(): string {
  try {
    const value = localStorage.getItem(STORAGE_KEY)?.trim()
    return value || BUILTIN_ITEM_LABEL_TEMPLATE_ID
  } catch {
    return BUILTIN_ITEM_LABEL_TEMPLATE_ID
  }
}

export function writeItemLabelTemplatePreference(templateId: string) {
  try {
    localStorage.setItem(STORAGE_KEY, templateId)
  } catch {
    // private mode / quota
  }
}

export function isBuiltinItemLabelTemplate(templateId: string | null | undefined) {
  return !templateId || templateId === BUILTIN_ITEM_LABEL_TEMPLATE_ID
}
