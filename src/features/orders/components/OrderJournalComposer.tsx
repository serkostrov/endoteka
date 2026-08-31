import { ListTodo, Paperclip, Plus, Send, X } from 'lucide-react'
import { type ChangeEvent, type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import {
  ORDER_FILE_ACCEPT,
  ORDER_JOURNAL_MAX_FILES,
  ORDER_JOURNAL_NOTE_MAX_LENGTH,
} from '@/lib/constants/orders'
import { getErrorMessage } from '@/lib/errors'
import { useSheetDirty } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { validateOrderUploadFile } from '../services/orders-service'

const COMPOSER_MAX_HEIGHT_PX = 128

export type OrderJournalComposerSubmit = {
  text: string
  files: File[]
}

type OrderJournalComposerProps = {
  disabled?: boolean
  pending?: boolean
  hint?: string
  onSubmit: (payload: OrderJournalComposerSubmit) => void | Promise<void>
  onCreateTask?: () => void
}

export function OrderJournalComposer({
  disabled = false,
  pending = false,
  hint = 'Enter — отправить, Shift+Enter — новая строка.',
  onSubmit,
  onCreateTask,
}: OrderJournalComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const busy = disabled || pending || sending
  const trimmed = text.trim()
  const canSend = !busy && (trimmed.length > 0 || files.length > 0)
  const composerDirty = trimmed.length > 0 || files.length > 0
  useSheetDirty(composerDirty, persistDraft)

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`
  }, [text])

  function closeMenu() {
    setMenuOpen(false)
  }

  function addFiles(incoming: File[]) {
    const next: File[] = [...files]
    for (const file of incoming) {
      try {
        validateOrderUploadFile(file)
      } catch (error) {
        toast.error(`${file.name}: ${getErrorMessage(error)}`)
        continue
      }

      if (next.length >= ORDER_JOURNAL_MAX_FILES) {
        toast.error(`Можно прикрепить не больше ${ORDER_JOURNAL_MAX_FILES} файлов сразу.`)
        break
      }

      next.push(file)
    }

    setFiles(next)
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selected.length > 0) {
      addFiles(selected)
    }
  }

  async function persistDraft() {
    if (canSend) {
      if (trimmed.length > ORDER_JOURNAL_NOTE_MAX_LENGTH) {
        throw new Error(`Текст не должен превышать ${ORDER_JOURNAL_NOTE_MAX_LENGTH} символов.`)
      }
      await onSubmit({ text: trimmed, files })
      setText('')
      setFiles([])
      return
    }

    throw new Error('Допишите комментарий или прикрепите файл')
  }

  async function send() {
    if (!canSend) {
      return
    }
    if (trimmed.length > ORDER_JOURNAL_NOTE_MAX_LENGTH) {
      toast.error(`Текст не должен превышать ${ORDER_JOURNAL_NOTE_MAX_LENGTH} символов.`)
      return
    }

    setSending(true)
    try {
      await onSubmit({ text: trimmed, files })
      setText('')
      setFiles([])
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    void send()
  }

  return (
    <div className="border-t bg-background px-3 py-2">
      {files.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex max-w-full items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-1 text-xs"
            >
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Убрать ${file.name}`}
                disabled={busy}
                onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-start gap-1">
        <input
          ref={fileInput}
          type="file"
          accept={ORDER_FILE_ACCEPT}
          multiple
          className="sr-only"
          disabled={busy}
          onChange={onFileChange}
        />
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label="Добавить"
              aria-expanded={menuOpen}
              className="shrink-0 rounded-full"
            >
              <Plus className={cn('size-5 transition-transform', menuOpen && 'rotate-45')} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-72 p-1.5">
            <div className="flex flex-col">
              <AttachChoice
                icon={<Paperclip className="size-4" />}
                title="Прикрепить файлы"
                description="Фото или PDF"
                onClick={() => {
                  closeMenu()
                  window.setTimeout(() => fileInput.current?.click(), 0)
                }}
              />
              {onCreateTask ? (
                <AttachChoice
                  icon={<ListTodo className="size-4" />}
                  title="Задача"
                  description="Назначение, срок и связь с заказом"
                  onClick={() => {
                    closeMenu()
                    onCreateTask()
                  }}
                />
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          rows={1}
          maxLength={ORDER_JOURNAL_NOTE_MAX_LENGTH}
          placeholder="Напишите событие…"
          className="field-sizing-fixed min-h-8 max-h-32 flex-1 resize-none overflow-y-auto py-1.5 leading-5"
        />
        <Button
          type="button"
          size="icon-sm"
          disabled={!canSend}
          aria-label="Отправить"
          className="shrink-0"
          onClick={() => void send()}
        >
          <Send />
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{hint}</p>
    </div>
  )
}

function AttachChoice({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
      onClick={onClick}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
