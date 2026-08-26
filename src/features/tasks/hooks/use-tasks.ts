import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  countOpenTasks,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  setTaskCompleted,
  updateTask,
  type CreateTaskInput,
  type TaskListFilters,
  type UpdateTaskInput,
} from '../services/tasks-service'

export function useTasks(filters: TaskListFilters, enabled = true) {
  return useQuery({
    queryKey: queryKeys.tasks.list(filters),
    queryFn: () => listTasks(filters),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.tasks.detail(id) : queryKeys.tasks.all,
    queryFn: () => getTask(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useOpenTaskCount(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.tasks.openCount,
    queryFn: countOpenTasks,
    enabled,
    refetchInterval: 60_000,
  })
}

function invalidateTasks(queryClient: ReturnType<typeof useQueryClient>, taskId?: string, orderId?: string | null) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
    taskId ? queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) }) : Promise.resolve(),
    orderId ? queryClient.invalidateQueries({ queryKey: queryKeys.orders.history(orderId) }) : Promise.resolve(),
  ])
}

export function useCreateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(input),
    onSuccess: async (_id, input) => {
      await invalidateTasks(queryClient, undefined, input.orderId)
    },
  })
}

export function useUpdateTask(taskId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateTaskInput) => updateTask(taskId, input),
    onSuccess: async () => {
      await invalidateTasks(queryClient, taskId)
    },
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { id: string; orderId?: string | null }) => deleteTask(input.id),
    onSuccess: async (_void, input) => {
      await invalidateTasks(queryClient, input.id, input.orderId)
    },
  })
}

export function useSetTaskCompleted() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { id: string; completed: boolean; orderId?: string | null }) =>
      setTaskCompleted(input.id, input.completed),
    onSuccess: async (_void, input) => {
      await invalidateTasks(queryClient, input.id, input.orderId)
    },
  })
}
