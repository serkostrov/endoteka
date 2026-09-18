import { useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'

import { cn } from '@/lib/utils'

export type FolderTreeGroup<T> = {
  id: string
  name: string
  items: T[]
  children?: FolderTreeGroup<T>[]
}

type FolderTreeProps<T> = {
  groups: FolderTreeGroup<T>[]
  /** Раскрывать все папки (поиск / короткие списки). По умолчанию закрыты. */
  expandAll?: boolean
  getItemId: (item: T) => string
  renderItem: (item: T) => ReactNode
  className?: string
  empty?: ReactNode
}

export function FolderTree<T>({
  groups,
  expandAll = false,
  getItemId,
  renderItem,
  className,
  empty,
}: FolderTreeProps<T>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (groups.length === 0) {
    return <>{empty}</>
  }

  function isOpen(id: string) {
    if (Object.prototype.hasOwnProperty.call(expanded, id)) {
      return Boolean(expanded[id])
    }
    return expandAll
  }

  function toggle(id: string) {
    setExpanded((current) => {
      const currentlyOpen = Object.prototype.hasOwnProperty.call(current, id)
        ? Boolean(current[id])
        : expandAll
      return { ...current, [id]: !currentlyOpen }
    })
  }

  return (
    <div className={cn('overflow-hidden rounded-md border', className)}>
      {groups.map((group) => (
        <FolderNode
          key={group.id}
          group={group}
          depth={0}
          isOpen={isOpen}
          onToggle={toggle}
          getItemId={getItemId}
          renderItem={renderItem}
        />
      ))}
    </div>
  )
}

function FolderNode<T>({
  group,
  depth,
  isOpen,
  onToggle,
  getItemId,
  renderItem,
}: {
  group: FolderTreeGroup<T>
  depth: number
  isOpen: (id: string) => boolean
  onToggle: (id: string) => void
  getItemId: (item: T) => string
  renderItem: (item: T) => ReactNode
}) {
  const open = isOpen(group.id)
  const children = group.children ?? []
  const count = children.length > 0 ? countLeaves(group) : group.items.length

  return (
    <FolderBlock
      title={group.name}
      count={count}
      open={open}
      depth={depth}
      onToggle={() => onToggle(group.id)}
    >
      {children.length > 0 ? (
        children.map((child) => (
          <FolderNode
            key={child.id}
            group={child}
            depth={depth + 1}
            isOpen={isOpen}
            onToggle={onToggle}
            getItemId={getItemId}
            renderItem={renderItem}
          />
        ))
      ) : (
        <ul>
          {group.items.map((item) => (
            <li key={getItemId(item)}>{renderItem(item)}</li>
          ))}
        </ul>
      )}
    </FolderBlock>
  )
}

function countLeaves<T>(group: FolderTreeGroup<T>): number {
  if (!group.children?.length) {
    return group.items.length
  }
  return group.children.reduce((sum, child) => sum + countLeaves(child), 0)
}

export function FolderBlock({
  title,
  count,
  open,
  onToggle,
  children,
  depth = 0,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
  depth?: number
}) {
  const Icon = open ? FolderOpen : Folder
  return (
    <div className={cn(depth === 0 && 'border-b last:border-b-0')}>
      <button
        type="button"
        className={cn(
          'flex h-10 w-full items-center gap-2 bg-muted/40 text-left text-sm font-medium hover:bg-muted/70',
          depth === 0 ? 'px-3' : 'pr-3',
        )}
        style={depth > 0 ? { paddingLeft: `${0.75 + depth * 1.25}rem` } : undefined}
        onClick={onToggle}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{title}</span>
        <span className="ml-auto text-[11px] font-normal tabular-nums text-muted-foreground">{count}</span>
      </button>
      {open ? <div className={cn('bg-background', depth === 0 && 'pb-3')}>{children}</div> : null}
    </div>
  )
}

export function FolderTreeItemButton({
  onClick,
  children,
  className,
  depth = 1,
  disabled,
  onMouseDown,
}: {
  onClick: () => void
  children: ReactNode
  className?: string
  /** Глубина листа: 1 — под одной папкой, 3 — классификация/бренд/модель */
  depth?: number
  disabled?: boolean
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
      className={cn(
        'flex h-12 w-full items-center gap-3 border-b border-border/70 pr-3 text-left text-sm last:border-b-0 hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
    >
      {children}
    </button>
  )
}

export function groupByFolderKey<T>(
  items: T[],
  getKey: (item: T) => { id: string; name: string },
): FolderTreeGroup<T>[] {
  const map = new Map<string, FolderTreeGroup<T>>()
  for (const item of items) {
    const key = getKey(item)
    const group = map.get(key.id) ?? { id: key.id, name: key.name, items: [] }
    group.items.push(item)
    map.set(key.id, group)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

/** Вложенные папки по уровням ключей; листья — на последнем уровне. */
export function nestByFolderKeys<T>(
  items: T[],
  levels: Array<(item: T) => { id: string; name: string }>,
): FolderTreeGroup<T>[] {
  if (levels.length === 0) {
    return []
  }

  const [getKey, ...rest] = levels
  const top = groupByFolderKey(items, getKey)

  if (rest.length === 0) {
    return top
  }

  return top.map((group) => ({
    ...group,
    items: [],
    children: nestByFolderKeys(group.items, rest),
  }))
}
