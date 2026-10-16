import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useActiveEmployees } from '@/features/users/hooks/use-users'
import { TASK_ASSIGNEE_NONE } from '@/lib/constants/tasks'

type TaskAssigneeSelectProps = {
  value: string
  onValueChange: (value: string) => void
  /** Текущий исполнитель задачи, если его уже нет в списке активных. */
  currentAssigneeId?: string | null
  currentAssigneeName?: string | null
  disabled?: boolean
  id?: string
}

export function TaskAssigneeSelect({
  value,
  onValueChange,
  currentAssigneeId = null,
  currentAssigneeName = null,
  disabled = false,
  id,
}: TaskAssigneeSelectProps) {
  const employees = useActiveEmployees()
  const items = employees.data ?? []
  const missingCurrent =
    Boolean(currentAssigneeId) && !items.some((employee) => employee.id === currentAssigneeId)

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Исполнитель</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full" aria-label="Исполнитель">
          <SelectValue placeholder="Исполнитель" />
        </SelectTrigger>
        <SelectContent searchable>
          <SelectItem value={TASK_ASSIGNEE_NONE}>Не назначен</SelectItem>
          {missingCurrent && currentAssigneeId ? (
            <SelectItem value={currentAssigneeId}>{currentAssigneeName || 'Исполнитель'}</SelectItem>
          ) : null}
          {items.map((employee) => (
            <SelectItem key={employee.id} value={employee.id}>
              {employee.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
