import { GripVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  fieldAllowsLayoutHeight,
  fieldLayoutHeightLabels,
  fieldLayoutHeightOf,
  fieldLayoutPreviewWidthClass,
  fieldLayoutWidthLabels,
  fieldLayoutWidthOf,
  snapFieldLayoutHeight,
  snapFieldLayoutWidth,
  type FieldLayoutHeight,
  type FieldLayoutWidth,
} from '@/lib/constants/fields'
import { cn } from '@/lib/utils'

import { DynamicFieldRenderer, DynamicFieldsGrid } from './DynamicFieldRenderer'
import { emptyFieldValue } from '../schemas'
import type { DynamicFieldDefinition, DynamicFieldValueData } from '../services/fields-service'

type LayoutDraft = {
  width: FieldLayoutWidth
  height: FieldLayoutHeight
}

type ResizeMode = 'width' | 'height' | 'both'

type ResizeSession = {
  fieldId: string
  mode: ResizeMode
  start: LayoutDraft
  allowHeight: boolean
}

type FieldsLayoutPreviewProps = {
  fields: DynamicFieldDefinition[]
  values: Record<string, DynamicFieldValueData>
  canUpdate: boolean
  onChangeValue: (code: string, value: DynamicFieldValueData) => void
  onReorder: (fromId: string, toId: string) => void
  onLayoutChange: (fieldId: string, width: FieldLayoutWidth, height: FieldLayoutHeight) => void
}

export function FieldsLayoutPreview({
  fields,
  values,
  canUpdate,
  onChangeValue,
  onReorder,
  onLayoutChange,
}: FieldsLayoutPreviewProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const cellsRef = useRef(new Map<string, HTMLDivElement>())
  const onLayoutChangeRef = useRef(onLayoutChange)
  onLayoutChangeRef.current = onLayoutChange
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, LayoutDraft>>({})
  const [resize, setResize] = useState<ResizeSession | null>(null)

  useEffect(() => {
    if (!resize) {
      return
    }

    const session = resize

    function layoutFromPointer(clientX: number, clientY: number): LayoutDraft {
      const cell = cellsRef.current.get(session.fieldId)
      const grid = gridRef.current
      const next = { ...session.start }
      if (!cell || !grid) {
        return next
      }

      const gridRect = grid.getBoundingClientRect()
      const cellRect = cell.getBoundingClientRect()
      const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0
      const colSize = (gridRect.width - gap * 11) / 12

      if (session.mode === 'width' || session.mode === 'both') {
        const cols = (clientX - cellRect.left + gap) / (colSize + gap)
        next.width = snapFieldLayoutWidth(cols)
      }
      if (session.allowHeight && (session.mode === 'height' || session.mode === 'both')) {
        next.height = snapFieldLayoutHeight(clientY - cellRect.top)
      }
      return next
    }

    function onMove(event: PointerEvent) {
      const next = layoutFromPointer(event.clientX, event.clientY)
      setDrafts((current) => ({ ...current, [session.fieldId]: next }))
    }

    function onUp(event: PointerEvent) {
      const next = layoutFromPointer(event.clientX, event.clientY)
      const changed = next.width !== session.start.width || next.height !== session.start.height
      setResize(null)
      if (changed) {
        onLayoutChangeRef.current(session.fieldId, next.width, next.height)
      } else {
        setDrafts((current) => {
          const { [session.fieldId]: _removed, ...rest } = current
          return rest
        })
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [resize])

  return (
    <DynamicFieldsGrid ref={gridRef} className={cn('gap-3', resize && 'select-none')}>
      {fields.map((field) => {
        const layout = drafts[field.id] ?? {
          width: fieldLayoutWidthOf(field),
          height: fieldLayoutHeightOf(field),
        }
        const previewField = { ...field, layoutWidth: layout.width, layoutHeight: layout.height }
        const resizing = resize?.fieldId === field.id
        const allowHeight = fieldAllowsLayoutHeight(field)

        return (
          <div
            key={field.id}
            ref={(node) => {
              if (node) {
                cellsRef.current.set(field.id, node)
              } else {
                cellsRef.current.delete(field.id)
              }
            }}
            className={cn(
              'group relative min-w-0 rounded-md border bg-background p-2.5',
              fieldLayoutPreviewWidthClass(previewField),
              dragId === field.id && 'opacity-40',
              dropId === field.id && dragId && dragId !== field.id && 'ring-2 ring-primary/40',
              resizing && 'ring-2 ring-primary/50',
            )}
            onDragOver={(event) => {
              if (!canUpdate || resize) {
                return
              }
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropId(field.id)
            }}
            onDragLeave={() => {
              setDropId((current) => (current === field.id ? null : current))
            }}
            onDrop={(event) => {
              event.preventDefault()
              const fromId = dragId ?? event.dataTransfer.getData('text/plain')
              if (fromId) {
                onReorder(fromId, field.id)
              }
              setDragId(null)
              setDropId(null)
            }}
          >
            {canUpdate ? (
              <span
                className="text-muted-foreground hover:text-foreground absolute top-1.5 left-0.5 z-10 inline-flex cursor-grab rounded-sm p-0.5 active:cursor-grabbing"
                draggable
                aria-label={`Переместить «${field.name}»`}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', field.id)
                  event.dataTransfer.effectAllowed = 'move'
                  setDragId(field.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setDropId(null)
                }}
              >
                <GripVertical className="size-3.5" />
              </span>
            ) : null}

            {resizing ? (
              <span className="bg-background/90 text-muted-foreground absolute top-1.5 right-2 z-10 rounded px-1 text-[10px] tabular-nums">
                {allowHeight
                  ? `${fieldLayoutWidthLabels[layout.width]} · ${fieldLayoutHeightLabels[layout.height]}`
                  : fieldLayoutWidthLabels[layout.width]}
              </span>
            ) : null}

            <DynamicFieldRenderer
              applyLayout={false}
              field={previewField}
              className={cn('space-y-1.5', canUpdate && 'pl-4')}
              value={values[field.code] ?? emptyFieldValue(field)}
              onChange={(value) => onChangeValue(field.code, value)}
            />

            {canUpdate ? (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Ширина «${field.name}»`}
                  className="hover:bg-primary/40 group-hover:bg-border absolute inset-y-1 right-0 w-1.5 cursor-ew-resize rounded-full bg-transparent touch-none"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setResize({ fieldId: field.id, mode: 'width', start: layout, allowHeight })
                  }}
                />
                {allowHeight ? (
                  <>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Высота «${field.name}»`}
                      className="hover:bg-primary/40 group-hover:bg-border absolute inset-x-1 bottom-0 h-1.5 cursor-ns-resize rounded-full bg-transparent touch-none"
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setResize({ fieldId: field.id, mode: 'height', start: layout, allowHeight })
                      }}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Размер «${field.name}»`}
                      className="border-muted-foreground/40 hover:border-primary absolute right-0.5 bottom-0.5 size-2.5 cursor-nwse-resize rounded-sm border-r-2 border-b-2 bg-transparent touch-none"
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setResize({ fieldId: field.id, mode: 'both', start: layout, allowHeight })
                      }}
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        )
      })}
    </DynamicFieldsGrid>
  )
}
