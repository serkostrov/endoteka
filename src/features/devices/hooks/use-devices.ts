import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'

import {
  createDevice,
  deleteDevice,
  getDeviceCard,
  getWarrantyDefaults,
  listDeviceRegistryBrands,
  listDeviceRegistryDevices,
  listDeviceRegistryGroups,
  listDevices,
  searchDeviceSerial,
  updateDevice,
  type DeviceInput,
  type UpdateDeviceInput,
} from '../services/devices-service'

export function useDevices(search: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: queryKeys.devices.list({ search, page, pageSize }),
    queryFn: () => listDevices(search, page, pageSize),
    placeholderData: keepPreviousData,
  })
}

export function useDeviceRegistryGroups(search: string) {
  return useQuery({
    queryKey: queryKeys.devices.registryGroups(search),
    queryFn: () => listDeviceRegistryGroups(search),
    placeholderData: keepPreviousData,
  })
}

export function useDeviceRegistryBrands(search: string, groupKey: string | null) {
  return useQuery({
    queryKey: queryKeys.devices.registryBrands(search, groupKey ?? ''),
    queryFn: () => listDeviceRegistryBrands(search, groupKey!),
    enabled: Boolean(groupKey),
    placeholderData: keepPreviousData,
  })
}

export function useDeviceRegistryDevices(
  search: string,
  groupKey: string | null,
  brandKey: string | null,
) {
  return useQuery({
    queryKey: queryKeys.devices.registryDevices(search, groupKey ?? '', brandKey ?? ''),
    queryFn: () => listDeviceRegistryDevices(search, groupKey!, brandKey!),
    enabled: Boolean(groupKey && brandKey),
    placeholderData: keepPreviousData,
  })
}

export function useSerialSearch(query: string, enabled = true) {
  const term = query.trim()

  return useQuery({
    queryKey: queryKeys.devices.serial(term),
    queryFn: () => searchDeviceSerial(term),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function useDeviceCard(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.devices.detail(id) : queryKeys.devices.all,
    queryFn: () => getDeviceCard(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useWarrantyDefaults(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.devices.warrantyDefaults,
    queryFn: getWarrantyDefaults,
    enabled,
    staleTime: 60_000,
  })
}

export function useCreateDevice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: DeviceInput) => createDevice(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices.all })
    },
  })
}

export function useDeleteDevice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (deviceId: string) => deleteDevice(deviceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices.all })
    },
  })
}

export function useUpdateDevice(deviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateDeviceInput) => updateDevice(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices.detail(deviceId) })
    },
  })
}
