import { z } from 'zod'

import { DIAGNOSTIC_ENGINEER_NONE } from './constants'

export const diagnosticsWorkspaceSchema = z.object({
  engineerId: z.string(),
  conclusion: z.string(),
})

export type DiagnosticsWorkspaceFormValues = z.infer<typeof diagnosticsWorkspaceSchema>

export function engineerIdToNull(value: string) {
  return !value || value === DIAGNOSTIC_ENGINEER_NONE ? null : value
}
