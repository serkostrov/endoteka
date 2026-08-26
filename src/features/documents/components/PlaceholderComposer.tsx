import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Braces } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import {
  groupPlaceholders,
  isPlaceholderKey,
  parseTemplateText,
  placeholderRegistry,
  placeholdersForContext,
  type PlaceholderDefinition,
  type PlaceholderInsertContext,
  type PlaceholderKey,
} from '../placeholders'

const CHIP_CLASS =
  'mx-0.5 inline-flex max-w-full items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 align-middle text-xs font-medium text-primary'

type PlaceholderComposerProps = {
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  context?: PlaceholderInsertContext
  'aria-label'?: string
}

export function PlaceholderField({
  label,
  value,
  onChange,
  multiline = false,
  context = 'document',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  context?: PlaceholderInsertContext
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <PlaceholderComposer value={value} onChange={onChange} multiline={multiline} context={context} />
    </div>
  )
}

export function PlaceholderKeySelect({
  value,
  onChange,
}: {
  value: PlaceholderKey
  onChange: (key: PlaceholderKey) => void
}) {
  const placeholders = placeholdersForContext('document')
  const current = placeholderRegistry[value]

  return (
    <div className="space-y-2">
      <Label>Поле</Label>
      <PlaceholderPicker
        placeholders={placeholders}
        onSelect={onChange}
        trigger={
          <Button type="button" variant="outline" className="w-full justify-start font-normal">
            <span className={cn(CHIP_CLASS, 'mx-0')}>{current.label}</span>
            <span className="ml-auto text-muted-foreground">{current.group}</span>
          </Button>
        }
      />
    </div>
  )
}

export function PlaceholderComposer({
  value,
  onChange,
  multiline = false,
  context = 'document',
  'aria-label': ariaLabel,
}: PlaceholderComposerProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [open, setOpen] = useState(false)
  const placeholders = useMemo(() => placeholdersForContext(context), [context])

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    if (document.activeElement === editor) {
      return
    }
    editor.innerHTML = templateValueToHtml(value)
  }, [value])

  function emitChange() {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    onChange(serializeEditor(editor))
  }

  function saveSelection() {
    const selection = window.getSelection()
    const editor = editorRef.current
    if (!selection || selection.rangeCount === 0 || !editor) {
      return
    }
    const range = selection.getRangeAt(0)
    if (editor.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange()
    }
  }

  function insertField(key: PlaceholderKey) {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    editor.focus()
    const selection = window.getSelection()
    if (!selection) {
      return
    }

    const range = restoreRange(editor, savedRange.current, selection)
    deleteBraceTrigger(range)
    range.deleteContents()
    const chip = createChip(key)
    range.insertNode(chip)
    const spacer = document.createTextNode('\u200B')
    chip.after(spacer)
    range.setStartAfter(spacer)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    savedRange.current = range.cloneRange()
    emitChange()
  }

  function deleteChip(chip: HTMLElement) {
    const editor = editorRef.current
    removeChip(chip)
    if (!editor) {
      return
    }
    const next = serializeEditor(editor)
    onChange(next)
  }

  function deleteSelectedOrAdjacentChip(direction: 'backward' | 'forward') {
    const editor = editorRef.current
    if (!editor) {
      return false
    }

    const selected = selectedChips(editor)
    if (selected.length > 0) {
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
      selected.forEach(removeChip)
      if (range && editor.contains(range.commonAncestorContainer)) {
        try {
          range.deleteContents()
        } catch {
          // Range can invalidate after removing non-editable chips.
        }
      }
      onChange(serializeEditor(editor))
      return true
    }

    const enclosed = enclosingChip(editor)
    if (enclosed) {
      deleteChip(enclosed)
      return true
    }

    const chip = direction === 'backward' ? chipBeforeCaret(editor) : chipAfterCaret(editor)
    if (!chip) {
      return false
    }
    deleteChip(chip)
    return true
  }

  return (
    <div
      className="relative"
      onPointerDownCapture={(event) => {
        const target = event.target
        if (!(target instanceof Element)) {
          return
        }
        const remove = target.closest('[data-remove-placeholder]')
        const chip = remove?.closest('[data-placeholder]')
        if (!(chip instanceof HTMLElement) || !isChip(chip) || !editorRef.current?.contains(chip)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        deleteChip(chip)
      }}
    >
      <div
        ref={editorRef}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline={multiline}
        contentEditable
        suppressContentEditableWarning
        className={cn(
          'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1.5 pr-9 text-sm shadow-xs outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-empty-placeholder)]',
          multiline ? 'min-h-20 whitespace-pre-wrap' : 'min-h-9',
        )}
        data-empty-placeholder="Текст или вставьте поле"
        onInput={() => {
          emitChange()
          const before = textBeforeCaret()
          if (before.endsWith('{') || before.endsWith('{{')) {
            saveSelection()
            setOpen(true)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !multiline) {
            event.preventDefault()
            return
          }
          if (event.key === 'Backspace' && deleteSelectedOrAdjacentChip('backward')) {
            event.preventDefault()
            return
          }
          if (event.key === 'Delete' && deleteSelectedOrAdjacentChip('forward')) {
            event.preventDefault()
          }
        }}
        onBlur={saveSelection}
        onPaste={(event) => {
          event.preventDefault()
          const text = event.clipboardData.getData('text/plain')
          insertPlainText(text)
          const editor = editorRef.current
          if (!editor) {
            return
          }
          const next = serializeEditor(editor)
          onChange(next)
          editor.innerHTML = templateValueToHtml(next)
          placeCaretAtEnd(editor)
          saveSelection()
        }}
      />
      <PlaceholderPicker
        open={open}
        onOpenChange={(next) => {
          if (next) {
            saveSelection()
          }
          setOpen(next)
        }}
        placeholders={placeholders}
        onSelect={insertField}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-1 right-1 text-muted-foreground"
            aria-label="Вставить поле"
          >
            <Braces />
          </Button>
        }
      />
    </div>
  )
}

function PlaceholderPicker({
  placeholders,
  onSelect,
  trigger,
  open,
  onOpenChange,
}: {
  placeholders: PlaceholderDefinition[]
  onSelect: (key: PlaceholderKey) => void
  trigger: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = open !== undefined
  const resolvedOpen = isControlled ? open : uncontrolledOpen
  const [prevOpen, setPrevOpen] = useState(resolvedOpen)
  if (resolvedOpen !== prevOpen) {
    setPrevOpen(resolvedOpen)
    if (resolvedOpen) {
      setQuery('')
      setActiveIndex(0)
    }
  }

  function setResolvedOpen(next: boolean) {
    if (!isControlled) {
      setUncontrolledOpen(next)
    }
    onOpenChange?.(next)
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return placeholders
    }
    return placeholders.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        item.key.toLowerCase().includes(needle) ||
        item.group.toLowerCase().includes(needle),
    )
  }, [placeholders, query])
  const groups = useMemo(() => groupPlaceholders(filtered), [filtered])

  function choose(key: PlaceholderKey) {
    onSelect(key)
    setQuery('')
    setResolvedOpen(false)
  }

  return (
    <Popover open={resolvedOpen} onOpenChange={setResolvedOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            placeholder="Найти поле"
            aria-label="Найти поле"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(filtered.length - 1, index + 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(0, index - 1))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const item = filtered[activeIndex]
                if (item) {
                  choose(item.key)
                }
              }
            }}
          />
        </div>
        <div className="max-h-64 overflow-auto py-1">
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</p>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="px-1 py-1">
                <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{group.name}</p>
                {group.items.map((item) => {
                  const index = filtered.indexOf(item)
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                        index === activeIndex ? 'bg-accent' : 'hover:bg-muted',
                      )}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(item.key)}
                    >
                      <span>{item.label}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{item.key}</span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function templateValueToHtml(value: string) {
  return parseTemplateText(value)
    .map((segment) => {
      if (segment.type === 'text') {
        return escapeHtml(segment.value).replaceAll('\n', '<br>')
      }
      return chipHtml(segment.key)
    })
    .join('')
}

function chipHtml(key: PlaceholderKey) {
  const label = escapeHtml(placeholderRegistry[key].label)
  return `<span data-placeholder="${key}" contenteditable="false" class="${CHIP_CLASS} pointer-events-auto select-none">${label}<span data-remove-placeholder="true" role="button" class="pointer-events-auto ml-0.5 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-primary/70 hover:text-primary" aria-label="Убрать поле"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span></span>`
}

function createChip(key: PlaceholderKey) {
  const template = document.createElement('template')
  template.innerHTML = chipHtml(key).trim()
  return template.content.firstElementChild as HTMLElement
}

function serializeEditor(root: HTMLElement) {
  const parts: string[] = []

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push((node.textContent ?? '').replaceAll('\u200B', ''))
      return
    }
    if (!(node instanceof HTMLElement)) {
      return
    }
    const key = node.dataset.placeholder
    if (key && isPlaceholderKey(key)) {
      parts.push(`{{${key}}}`)
      return
    }
    if (node.tagName === 'BR') {
      parts.push('\n')
      return
    }
    node.childNodes.forEach(walk)
  }

  root.childNodes.forEach(walk)
  return parts.join('')
}

function isChip(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && isPlaceholderKey(node.dataset.placeholder ?? '')
}

function isZwspOnly(node: Node | null) {
  return node?.nodeType === Node.TEXT_NODE && (node.textContent ?? '').replaceAll('\u200B', '') === ''
}

function removeChip(chip: HTMLElement) {
  const next = chip.nextSibling
  chip.remove()
  if (isZwspOnly(next) && next) {
    next.remove()
  }
}

function chipBeforeCaret(editor: HTMLElement | null) {
  if (!editor) {
    return null
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)
  const node = range.startContainer
  const offset = range.startOffset

  if (node === editor) {
    return findChipBackward(editor.childNodes[offset - 1] ?? null)
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const before = (node.textContent ?? '').slice(0, offset).replaceAll('\u200B', '')
    if (before.length > 0) {
      return null
    }
    return findChipBackward(node.previousSibling)
  }

  if (isChip(node)) {
    return node
  }

  return null
}

function chipAfterCaret(editor: HTMLElement | null) {
  if (!editor) {
    return null
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)
  const node = range.startContainer
  const offset = range.startOffset

  if (node === editor) {
    return findChipForward(editor.childNodes[offset] ?? null)
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const after = (node.textContent ?? '').slice(offset).replaceAll('\u200B', '')
    if (after.length > 0) {
      return null
    }
    return findChipForward(node.nextSibling)
  }

  return null
}

function findChipBackward(start: Node | null) {
  let node = start
  while (node && isIgnorable(node)) {
    node = node.previousSibling
  }
  return isChip(node) ? node : null
}

function findChipForward(start: Node | null) {
  let node = start
  while (node && isIgnorable(node)) {
    node = node.nextSibling
  }
  return isChip(node) ? node : null
}

function isIgnorable(node: Node | null) {
  if (!node) {
    return false
  }
  if (isZwspOnly(node)) {
    return true
  }
  return node instanceof HTMLElement && node.tagName === 'BR'
}

function selectedChips(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return []
  }
  const range = selection.getRangeAt(0)
  return [...editor.querySelectorAll<HTMLElement>('[data-placeholder]')].filter((chip) =>
    range.intersectsNode(chip),
  )
}

function enclosingChip(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return null
  }
  const node = selection.getRangeAt(0).startContainer
  const el = node instanceof Element ? node : node.parentElement
  const chip = el?.closest('[data-placeholder]') ?? null
  if (!isChip(chip) || chip === editor || !editor.contains(chip)) {
    return null
  }
  return chip
}

function restoreRange(editor: HTMLElement, saved: Range | null, selection: Selection) {
  if (saved && editor.contains(saved.commonAncestorContainer)) {
    selection.removeAllRanges()
    selection.addRange(saved)
    return saved
  }
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
  return range
}

function deleteBraceTrigger(range: Range) {
  if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) {
    return
  }
  const node = range.startContainer
  const text = node.textContent ?? ''
  const offset = range.startOffset
  const before = text.slice(0, offset)
  const start = before.lastIndexOf('{')
  if (start < 0) {
    return
  }
  const trigger = document.createRange()
  trigger.setStart(node, start)
  trigger.setEnd(node, offset)
  trigger.deleteContents()
}

function textBeforeCaret() {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return ''
  }
  const range = selection.getRangeAt(0)
  if (range.startContainer.nodeType !== Node.TEXT_NODE) {
    return ''
  }
  return (range.startContainer.textContent ?? '').slice(0, range.startOffset)
}

function insertPlainText(text: string) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return
  }
  const range = selection.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function placeCaretAtEnd(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection) {
    return
  }
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
