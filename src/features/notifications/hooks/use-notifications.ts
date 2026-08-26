import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  countUnreadNotifications,
  createTelegramLinkCode,
  deleteNotificationRule,
  getMyTelegramLink,
  getNotificationAdmin,
  listMyNotifications,
  markNotificationRead,
  markNotificationsRead,
  saveNotificationChannelSettings,
  unlinkTelegram,
  upsertNotificationRule,
  type NotificationChannelSettings,
  type NotificationRule,
} from '../services/notifications-service'

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.notifications.list,
    queryFn: listMyNotifications,
    enabled,
    refetchInterval: 60_000,
  })
}

export function useUnreadNotificationCount(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: countUnreadNotifications,
    enabled,
    refetchInterval: 60_000,
  })
}

export function useNotificationAdmin(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.notifications.settings,
    queryFn: getNotificationAdmin,
    enabled,
  })
}

export function useMyTelegramLink(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.notifications.telegram,
    queryFn: getMyTelegramLink,
    enabled,
  })
}

function invalidateNotifications(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
  ])
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: async () => {
      await invalidateNotifications(queryClient)
    },
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: async () => {
      await invalidateNotifications(queryClient)
    },
  })
}

export function useSaveNotificationChannels() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: NotificationChannelSettings) => saveNotificationChannelSettings(input),
    onSuccess: async () => {
      await invalidateNotifications(queryClient)
    },
  })
}

export function useUpsertNotificationRule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      id: string | null
      eventCode: string
      targetKind: NotificationRule['targetKind']
      roleId: string | null
      channelInApp: boolean
      channelEmail: boolean
      channelTelegram: boolean
      isActive: boolean
    }) => upsertNotificationRule(input),
    onSuccess: async () => {
      await invalidateNotifications(queryClient)
    },
  })
}

export function useDeleteNotificationRule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteNotificationRule(id),
    onSuccess: async () => {
      await invalidateNotifications(queryClient)
    },
  })
}

export function useCreateTelegramLinkCode() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createTelegramLinkCode,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.telegram })
    },
  })
}

export function useUnlinkTelegram() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: unlinkTelegram,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.telegram })
    },
  })
}
