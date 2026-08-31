export const DiagnosticJournalEvent = {
  Created: 'diagnostics_created',
  Updated: 'diagnostics_updated',
  StatusChanged: 'status_changed',
} as const

export type DiagnosticJournalEvent = (typeof DiagnosticJournalEvent)[keyof typeof DiagnosticJournalEvent]
