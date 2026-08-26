import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { FilterBar } from '@/components/shared/FilterBar'
import { IconActionButton } from '@/components/shared/IconActionButton'
import { LoadingState } from '@/components/shared/LoadingState'
import { PageHeader } from '@/components/shared/PageHeader'
import { SearchInput } from '@/components/shared/SearchInput'
import { SectionCard } from '@/components/shared/SectionCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useHasPermission } from '@/features/auth'
import { fieldTypeLabels } from '@/lib/constants/fields'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/errors'
import { moveIndex } from '@/lib/utils/reorder'

import { DynamicFieldEditor } from './DynamicFieldEditor'
import { DynamicFieldRenderer } from './DynamicFieldRenderer'
import {
  useDynamicFieldUsage,
  useDynamicFields,
  useFieldEntities,
  useFieldTypes,
  useReorderDynamicFields,
  useSetDynamicFieldActive,
  useUpsertDynamicField,
  useDeleteDynamicField,
} from '../hooks/use-fields'
import { emptyFieldValue, type DynamicFieldFormValues } from '../schemas'
import type { DynamicFieldDefinition, DynamicFieldValueData } from '../services/fields-service'

export function EntityFieldsScreen() {
  const { entity } = useParams()
  const canUpdate = useHasPermission(Permission.SettingsUpdate)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingField, setEditingField] = useState<DynamicFieldDefinition | null>(null)
  const [statusTarget, setStatusTarget] = useState<DynamicFieldDefinition | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DynamicFieldDefinition | null>(null)
  const [previewValues, setPreviewValues] = useState<Record<string, DynamicFieldValueData>>({})
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const entitiesQuery = useFieldEntities()
  const typesQuery = useFieldTypes()
  const fieldsQuery = useDynamicFields(entity)
  const entityRow = entitiesQuery.data?.find((item) => item.code === entity)
  const save = useUpsertDynamicField(entity ?? '')
  const setActive = useSetDynamicFieldActive(entity ?? '')
  const remove = useDeleteDynamicField(entity ?? '')
  const reorder = useReorderDynamicFields(entity ?? '')
  const usageQuery = useDynamicFieldUsage((statusTarget ?? editingField ?? deleteTarget)?.id)

  const fields = fieldsQuery.data ?? []
  const visibleFields = fields.filter((field) => {
    const haystack = `${field.name} ${field.code} ${field.groupName}`.toLowerCase()
    const matchesSearch = haystack.includes(search.trim().toLowerCase())
    const matchesStatus =
      status === 'all' || (status === 'active' ? field.isActive : !field.isActive)
    return matchesSearch && matchesStatus
  })
  const previewFields = fields.filter((field) => field.isActive)
  const nextActive = statusTarget ? !statusTarget.isActive : false

  if (entitiesQuery.isLoading || fieldsQuery.isLoading) {
    return <LoadingState label="Загружаем поля…" />
  }

  if (fieldsQuery.error) {
    return <ErrorState description={getErrorMessage(fieldsQuery.error)} />
  }

  if (!entity || !entityRow) {
    return (
      <ErrorState
        title="Раздел не найден"
        description="Проверьте адрес или вернитесь к списку разделов."
        action={
          <Button asChild variant="outline">
            <Link to={routes.settingsFields}>К полям карточек</Link>
          </Button>
        }
      />
    )
  }

  const currentEntity = entityRow

  async function handleSave(values: DynamicFieldFormValues) {
    await save.mutateAsync({
      id: editingField?.id,
      entityCode: currentEntity.code,
      code: values.code,
      name: values.name,
      fieldType: values.fieldType,
      isRequired: values.isRequired,
      groupName: values.groupName.trim(),
      options: values.options.map((option, index) => ({
        code: option.code,
        label: option.label,
        isActive: option.isActive,
        sortOrder: index,
      })),
    })
    toast.success('Поле сохранено')
    setEditorOpen(false)
    setEditingField(null)
  }

  async function handleToggleActive() {
    if (!statusTarget) {
      return
    }

    try {
      await setActive.mutateAsync({ fieldId: statusTarget.id, isActive: nextActive })
      toast.success(nextActive ? 'Поле включено' : 'Поле скрыто')
      setStatusTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }

    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Поле удалено')
      setDeleteTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function persistOrder(nextFields: DynamicFieldDefinition[]) {
    try {
      await reorder.mutateAsync(nextFields.map((field) => field.id))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const usageCount = usageQuery.data ?? 0
  const showReorder = canUpdate && status === 'all' && search.trim() === ''

  return (
    <div className="space-y-4">
      <PageHeader
        title={entityRow.name}
        description={entityRow.description ?? 'Дополнительные поля этого раздела.'}
        actions={
          canUpdate ? (
            <Button
              type="button"
              onClick={() => {
                setEditingField(null)
                setEditorOpen(true)
              }}
            >
              Добавить поле
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} label="Поиск по полям" placeholder="Название" />
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger aria-label="Фильтр по статусу">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="inactive">Скрытые</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {visibleFields.length === 0 ? (
        <EmptyState title="Поля не найдены" description="Добавьте поле или измените фильтр." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {showReorder ? <TableHead className="w-10" /> : null}
              <TableHead>Название</TableHead>
              <TableHead>Группа</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Обязательное</TableHead>
              <TableHead>Статус</TableHead>
              {canUpdate ? <TableHead className="w-[1%] whitespace-nowrap">Действия</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleFields.map((field, index) => (
              <TableRow
                key={field.id}
                draggable={showReorder}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex === null) {
                    return
                  }
                  void persistOrder(moveIndex(fields, dragIndex, index))
                  setDragIndex(null)
                }}
              >
                {showReorder ? (
                  <TableCell className="text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <GripVertical className="size-4 cursor-grab" aria-hidden="true" />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Выше"
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => void persistOrder(moveIndex(fields, index, index - 1))}
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Ниже"
                        disabled={index === visibleFields.length - 1 || reorder.isPending}
                        onClick={() => void persistOrder(moveIndex(fields, index, index + 1))}
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                    </span>
                  </TableCell>
                ) : null}
                <TableCell className="font-medium">{field.name}</TableCell>
                <TableCell>{field.groupName || '—'}</TableCell>
                <TableCell>{fieldTypeLabels[field.fieldType]}</TableCell>
                <TableCell>{field.isRequired ? 'Да' : 'Нет'}</TableCell>
                <TableCell>
                  <StatusBadge tone={field.isActive ? 'success' : 'neutral'}>
                    {field.isActive ? 'Активно' : 'Скрыто'}
                  </StatusBadge>
                </TableCell>
                {canUpdate ? (
                  <TableCell>
                    <div className="flex gap-1">
                      <IconActionButton
                        label="Изменить"
                        onClick={() => {
                          setEditingField(field)
                          setEditorOpen(true)
                        }}
                      >
                        <Pencil />
                      </IconActionButton>
                      <IconActionButton
                        label={field.isActive ? 'Скрыть' : 'Включить'}
                        onClick={() => setStatusTarget(field)}
                      >
                        {field.isActive ? <EyeOff /> : <Eye />}
                      </IconActionButton>
                      <IconActionButton
                        label="Удалить"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(field)}
                      >
                        <Trash2 />
                      </IconActionButton>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {previewFields.length > 0 ? (
        <SectionCard title="Предпросмотр" description="Так поля появятся на карточке раздела.">
          <div className="grid gap-4 md:grid-cols-2">
            {previewFields.map((field) => (
              <DynamicFieldRenderer
                key={field.id}
                field={field}
                value={previewValues[field.code] ?? emptyFieldValue(field)}
                onChange={(value) =>
                  setPreviewValues((current) => ({
                    ...current,
                    [field.code]: value,
                  }))
                }
              />
            ))}
          </div>
        </SectionCard>
      ) : null}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) {
            setEditingField(null)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingField ? 'Изменить поле' : 'Новое поле'}</DialogTitle>
            <DialogDescription>Раздел: {entityRow.name}.</DialogDescription>
          </DialogHeader>
          <DynamicFieldEditor
            key={editingField?.id ?? 'new'}
            field={editingField}
            fieldTypes={typesQuery.data ?? []}
            usageCount={editingField ? usageCount : 0}
            usedCodes={fields.filter((item) => item.id !== editingField?.id).map((item) => item.code)}
            isPending={save.isPending}
            onSubmit={handleSave}
            onCancel={() => {
              setEditorOpen(false)
              setEditingField(null)
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={nextActive ? 'Включить поле' : 'Скрыть поле'}
        description={
          statusTarget
            ? nextActive
              ? `${statusTarget.name} снова появится в формах.`
              : usageCount > 0
                ? `${statusTarget.name} уже заполнено в ${usageCount} записях. Поле будет скрыто в новых формах, введённые значения сохранятся.`
                : `${statusTarget.name} будет скрыто в формах. Удаление не выполняется.`
            : ''
        }
        confirmLabel={nextActive ? 'Включить' : 'Скрыть'}
        confirmVariant={nextActive ? 'default' : 'destructive'}
        isPending={setActive.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setStatusTarget(null)
          }
        }}
        onConfirm={() => void handleToggleActive()}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить поле"
        description={
          deleteTarget
            ? usageCount > 0
              ? `${deleteTarget.name} заполнено в ${usageCount} записях. Поле и эти значения будут удалены безвозвратно.`
              : `${deleteTarget.name} будет удалено безвозвратно.`
            : ''
        }
        confirmLabel="Удалить"
        isPending={remove.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}
