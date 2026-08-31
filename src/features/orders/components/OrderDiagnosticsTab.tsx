import { DiagnosticsWorkspace } from '@/features/diagnostics'

type OrderDiagnosticsTabProps = {
  orderId: string
}

export function OrderDiagnosticsTab({ orderId }: OrderDiagnosticsTabProps) {
  return <DiagnosticsWorkspace orderId={orderId} />
}
