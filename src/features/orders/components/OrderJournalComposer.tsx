import { Paperclip, Send, X } from 'lucide-react'
import { type ChangeEvent, type KeyboardEvent, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  ORDER_FILE_ACCEPT,
  ORDER_JOURNAL_MAX_FILES,
  ORDER_JOURNAL_NOTE_MAX_LENGTH,
} from '@/lib/constants/orders'
import { getErrorMessage } from '@/lib/errors'

import { validateOrderUploadFile } from '../services/orders-service'

export type OrderJournalComposerSubmit = {
  text: string
  files: File[]
}

type OrderJournalComposerProps = {
  disabled?: boolean
  pending?: boolean
  hint?: string
  onSubmit: (payload: OrderJournalComposerSubmit) => void | Promise<void>
}

export function OrderJournalComposer({
  disabled = false,
  pending = false,
  hint = 'Enter — отправить, Shift+Enter — новая строка. Фото или PDF до 5 ГБ.',
  onSubmit,
}: OrderJournalComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)

  const busy = disabled || pending || sending
  const trimmed = text.trim()
  const canSend = !busy && (trimmed.length > 0 || files.length > 0)

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

      <div className="flex items-end gap-1">
        <input
          ref={fileInput}
          type="file"
          accept={ORDER_FILE_ACCEPT}
          multiple
          className="sr-only"
          disabled={busy}
          onChange={onFileChange}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label="Прикрепить файл"
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip />
        </Button>
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          rows={2}
          maxLength={ORDER_JOURNAL_NOTE_MAX_LENGTH}
          placeholder="Напишите событие…"
          className="field-sizing-fixed min-h-10 max-h-32 flex-1 resize-none"
        />
        <Button type="button" size="icon-sm" disabled={!canSend} aria-label="Отправить" onClick={() => void send()}>
          <Send />
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{hint}</p>
    </div>
  )
}
