import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { matrixColumns, permissionModules } from '@/lib/constants/permission-catalog'
import type { Permission } from '@/lib/constants/permissions'
import { cn } from '@/lib/utils'

type PermissionMatrixProps = {
  selected: Permission[]
  onChange: (next: Permission[]) => void
  readOnly?: boolean
}

export function PermissionMatrix({ selected, onChange, readOnly = false }: PermissionMatrixProps) {
  const selectedSet = new Set(selected)

  function toggle(code: Permission, checked: boolean) {
    if (readOnly) {
      return
    }

    if (checked) {
      if (selectedSet.has(code)) {
        return
      }

      onChange([...selected, code])
      return
    }

    onChange(selected.filter((item) => item !== code))
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Раздел</TableHead>
          {matrixColumns.map((column) => (
            <TableHead key={column.id} className="text-center">
              {column.label}
            </TableHead>
          ))}
          <TableHead>Дополнительно</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {permissionModules.map((module) => (
          <TableRow key={module.resource}>
            <TableCell className="font-medium">{module.label}</TableCell>
            {matrixColumns.map((column) => {
              const code = module.cells[column.id]
              const unavailable = !code

              return (
                <TableCell key={column.id} className="text-center">
                  <label
                    className={cn(
                      'inline-flex justify-center',
                      (readOnly || unavailable) && 'opacity-70',
                      unavailable && 'cursor-not-allowed',
                    )}
                    title={unavailable ? 'Действие не используется в этом разделе' : undefined}
                  >
                    <span className="sr-only">
                      {module.label}: {column.label}
                      {unavailable ? ' (не применяется)' : ''}
                    </span>
                    <Checkbox
                      checked={code ? selectedSet.has(code) : false}
                      disabled={readOnly || unavailable}
                      onCheckedChange={(value) => {
                        if (!code) {
                          return
                        }
                        toggle(code, value === true)
                      }}
                    />
                  </label>
                </TableCell>
              )
            })}
            <TableCell>
              {module.extras.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  {module.extras.map((extra) => (
                    <label key={extra.code} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedSet.has(extra.code)}
                        disabled={readOnly}
                        onCheckedChange={(value) => toggle(extra.code, value === true)}
                      />
                      {extra.label}
                    </label>
                  ))}
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
