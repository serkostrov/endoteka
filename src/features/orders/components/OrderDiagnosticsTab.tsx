import { DiagnosticsWorkspace } from '@/features/diagnostics'

type OrderDiagnosticsTabProps = {
  orderId: string
  statusCode: string
}

export function OrderDiagnosticsTab({ orderId, statusCode }: OrderDiagnosticsTabProps) {
  return <DiagnosticsWorkspace orderId={orderId} statusCode={statusCode} />
}
