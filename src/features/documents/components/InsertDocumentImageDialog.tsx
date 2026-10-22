import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Link2, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/errors'
import { pickImageFiles } from '@/lib/pick-image-files'
import { cn } from '@/lib/utils'

import {
  DOCUMENT_TEMPLATE_ASSET_ACCEPT,
  uploadDocumentTemplateAsset,
} from '../services/document-assets-service'

export type InsertDocumentImageResult = {
  src: string
  alt: string
}

type InsertDocumentImageDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** logo — компактная вставка; image — обычная картинка. */
  mode: 'logo' | 'image'
  onInsert: (result: InsertDocumentImageResult) => void
}

export function InsertDocumentImageDialog({
  open,
  onOpenChange,
  mode,
  onInsert,
}: InsertDocumentImageDialogProps) {
  const [url, setUrl] = useState('')
  const [alt, setAlt] = useState(mode === 'logo' ? 'Логотип' : '')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      setUrl('')
      setAlt(mode === 'logo' ? 'Логотип' : '')
      setPreviewUrl(null)
      setUploading(false)
      setDragOver(false)
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [open, mode])

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [])

  async function handleFiles(files: File[]) {
    const file = files[0]
    if (!file || uploading) {
      return
    }
    setUploading(true)
    try {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
      objectUrlRef.current = URL.createObjectURL(file)
      setPreviewUrl(objectUrlRef.current)

      const uploaded = await uploadDocumentTemplateAsset(file)
      setUrl(uploaded.url)
      if (!alt.trim()) {
        setAlt(mode === 'logo' ? 'Логотип' : uploaded.fileName.replace(/\.[^.]+$/, ''))
      }
      toast.success('Изображение загружено')
    } catch (error) {
      toast.error(getErrorMessage(error))
      setPreviewUrl(null)
    } finally {
      setUploading(false)
    }
  }

  async function pickFile() {
    const files = await pickImageFiles({ accept: DOCUMENT_TEMPLATE_ASSET_ACCEPT })
    if (files.length > 0) {
      await handleFiles(files)
    }
  }

  function submit() {
    const src = url.trim()
    if (!src) {
      toast.error('Загрузите файл или укажите адрес картинки')
      return
    }
    onInsert({ src, alt: alt.trim() || (mode === 'logo' ? 'Логотип' : 'Изображение') })
    onOpenChange(false)
  }

  const title = mode === 'logo' ? 'Логотип' : 'Изображение'
  const description =
    mode === 'logo'
      ? 'Загрузите логотип с компьютера — он сохранится в шаблоне и будет виден при печати.'
      : 'Загрузите картинку с компьютера или вставьте ссылку.'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <button
            type="button"
            disabled={uploading}
            onClick={() => void pickFile()}
            onDragEnter={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              const files = Array.from(event.dataTransfer.files ?? [])
              void handleFiles(files)
            }}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
              dragOver
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/40',
              uploading && 'pointer-events-none opacity-70',
            )}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt=""
                className="max-h-24 max-w-full rounded-md object-contain"
              />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {uploading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
              </span>
            )}
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {uploading ? 'Загрузка…' : previewUrl ? 'Заменить файл' : 'Выберите файл или перетащите сюда'}
              </p>
              <p className="text-xs text-muted-foreground">JPEG, PNG или WebP · до 5 МБ</p>
            </div>
            {!uploading ? (
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-background px-2.5 py-1 text-xs font-medium ring-1 ring-border">
                <ImagePlus className="size-3.5" />
                Выбрать файл
              </span>
            ) : null}
          </button>

          <div className="space-y-2">
            <Label htmlFor="doc-image-alt">Подпись</Label>
            <Input
              id="doc-image-alt"
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
              placeholder={mode === 'logo' ? 'Логотип' : 'Описание'}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="doc-image-url" className="flex items-center gap-1.5 text-muted-foreground">
              <Link2 className="size-3.5" />
              Или адрес картинки
            </Label>
            <Input
              id="doc-image-url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                if (event.target.value.trim()) {
                  setPreviewUrl(event.target.value.trim())
                }
              }}
              placeholder="https://…"
              inputMode="url"
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="button" disabled={uploading || !url.trim()} onClick={submit}>
            Вставить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
