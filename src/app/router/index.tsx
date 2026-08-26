import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import { GuestOnly } from '@/app/guards/GuestOnly'
import { RequireAuth } from '@/app/guards/RequireAuth'
import { RequirePermission } from '@/app/guards/RequirePermission'
import { AppLayout } from '@/app/layouts/AppLayout'
import { AuthLayout } from '@/app/layouts/AuthLayout'
import { Permission } from '@/lib/constants/permissions'
import { routes } from '@/lib/constants/routes'
import { lazyNamedPage } from '@/lib/lazy-page'
import { AuthCallbackPage } from '@/pages/AuthCallbackPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SetPasswordPage } from '@/pages/SetPasswordPage'

const DashboardPage = lazyNamedPage(() => import('@/pages/DashboardPage'), 'DashboardPage')
const OrderNewPage = lazyNamedPage(() => import('@/pages/OrderNewPage'), 'OrderNewPage')
const OrdersPage = lazyNamedPage(() => import('@/pages/OrdersPage'), 'OrdersPage')
const OrderDetailPage = lazyNamedPage(() => import('@/pages/OrderDetailPage'), 'OrderDetailPage')
const TasksPage = lazyNamedPage(() => import('@/pages/TasksPage'), 'TasksPage')
const TaskDetailPage = lazyNamedPage(() => import('@/pages/TaskDetailPage'), 'TaskDetailPage')
const CustomersPage = lazyNamedPage(() => import('@/pages/CustomersPage'), 'CustomersPage')
const CustomerDetailPage = lazyNamedPage(() => import('@/pages/CustomerDetailPage'), 'CustomerDetailPage')
const DevicesPage = lazyNamedPage(() => import('@/pages/DevicesPage'), 'DevicesPage')
const DeviceDetailPage = lazyNamedPage(() => import('@/pages/DeviceDetailPage'), 'DeviceDetailPage')
const InventoryPage = lazyNamedPage(() => import('@/pages/InventoryPage'), 'InventoryPage')
const InventoryItemsPage = lazyNamedPage(() => import('@/pages/InventoryItemsPage'), 'InventoryItemsPage')
const InventoryItemPage = lazyNamedPage(() => import('@/pages/InventoryItemPage'), 'InventoryItemPage')
const InventoryReceiptsPage = lazyNamedPage(() => import('@/pages/InventoryReceiptsPage'), 'InventoryReceiptsPage')
const InventoryCountsPage = lazyNamedPage(() => import('@/pages/InventoryCountsPage'), 'InventoryCountsPage')
const InventoryCountPage = lazyNamedPage(() => import('@/pages/InventoryCountPage'), 'InventoryCountPage')
const SalesPage = lazyNamedPage(() => import('@/pages/SalesPage'), 'SalesPage')
const SaleDetailPage = lazyNamedPage(() => import('@/pages/SaleDetailPage'), 'SaleDetailPage')
const DocumentTemplatesPage = lazyNamedPage(() => import('@/pages/DocumentTemplatesPage'), 'DocumentTemplatesPage')
const DocumentTemplatePage = lazyNamedPage(() => import('@/pages/DocumentTemplatePage'), 'DocumentTemplatePage')
const DocumentTemplatePrintPage = lazyNamedPage(
  () => import('@/pages/DocumentTemplatePrintPage'),
  'DocumentTemplatePrintPage',
)
const DocumentsPage = lazyNamedPage(() => import('@/pages/DocumentsPage'), 'DocumentsPage')
const DocumentPrintPage = lazyNamedPage(() => import('@/pages/DocumentPrintPage'), 'DocumentPrintPage')
const DocumentDetailPage = lazyNamedPage(() => import('@/pages/DocumentDetailPage'), 'DocumentDetailPage')
const UsersPage = lazyNamedPage(() => import('@/pages/UsersPage'), 'UsersPage')
const RolesPage = lazyNamedPage(() => import('@/pages/RolesPage'), 'RolesPage')
const RoleDetailPage = lazyNamedPage(() => import('@/pages/RoleDetailPage'), 'RoleDetailPage')
const SettingsPage = lazyNamedPage(() => import('@/pages/SettingsPage'), 'SettingsPage')
const ReferencesPage = lazyNamedPage(() => import('@/pages/ReferencesPage'), 'ReferencesPage')
const ReferenceSetPage = lazyNamedPage(() => import('@/pages/ReferenceSetPage'), 'ReferenceSetPage')
const FieldEntitiesPage = lazyNamedPage(() => import('@/pages/FieldEntitiesPage'), 'FieldEntitiesPage')
const EntityFieldsPage = lazyNamedPage(() => import('@/pages/EntityFieldsPage'), 'EntityFieldsPage')
const OrderWorkflowPage = lazyNamedPage(() => import('@/pages/OrderWorkflowPage'), 'OrderWorkflowPage')
const OrderStatusesPage = lazyNamedPage(() => import('@/pages/OrderStatusesPage'), 'OrderStatusesPage')
const NotificationSettingsPage = lazyNamedPage(
  () => import('@/pages/NotificationSettingsPage'),
  'NotificationSettingsPage',
)
const AuditLogPage = lazyNamedPage(() => import('@/pages/AuditLogPage'), 'AuditLogPage')

const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      {
        element: <AuthLayout />,
        children: [{ path: routes.login, element: <LoginPage /> }],
      },
    ],
  },
  {
    element: <AuthLayout />,
    children: [{ path: routes.authCallback, element: <AuthCallbackPage /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AuthLayout />,
        children: [{ path: routes.setPassword, element: <SetPasswordPage /> }],
      },
      {
        element: <AppLayout />,
        children: [
          {
            element: <RequirePermission permission={Permission.DashboardRead} />,
            children: [{ path: routes.home, element: <DashboardPage /> }],
          },
          {
            element: <RequirePermission permission={Permission.OrdersCreate} />,
            children: [{ path: routes.ordersNew, element: <OrderNewPage /> }],
          },
          {
            element: <RequirePermission permission={Permission.OrdersRead} />,
            children: [
              { path: routes.orders, element: <OrdersPage /> },
              { path: routes.order, element: <OrderDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.TasksRead} />,
            children: [
              { path: routes.tasks, element: <TasksPage /> },
              { path: routes.task, element: <TaskDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.CustomersRead} />,
            children: [
              { path: routes.customers, element: <CustomersPage /> },
              { path: routes.customer, element: <CustomerDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.DevicesRead} />,
            children: [
              { path: routes.devices, element: <DevicesPage /> },
              { path: routes.device, element: <DeviceDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.InventoryRead} />,
            children: [
              { path: routes.inventory, element: <InventoryPage /> },
              { path: routes.inventoryItems, element: <InventoryItemsPage /> },
              { path: routes.inventoryItem, element: <InventoryItemPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.InventoryReceive} />,
            children: [{ path: routes.inventoryReceipts, element: <InventoryReceiptsPage /> }],
          },
          {
            element: <RequirePermission permission={Permission.InventoryCount} />,
            children: [
              { path: routes.inventoryCounts, element: <InventoryCountsPage /> },
              { path: routes.inventoryCount, element: <InventoryCountPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.SalesRead} />,
            children: [
              { path: routes.sales, element: <SalesPage /> },
              { path: routes.sale, element: <SaleDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.DocumentsEditTemplates} />,
            children: [
              { path: routes.documentTemplates, element: <DocumentTemplatesPage /> },
              { path: routes.documentTemplate, element: <DocumentTemplatePage /> },
              { path: routes.documentTemplatePrint, element: <DocumentTemplatePrintPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.DocumentsRead} />,
            children: [
              { path: routes.documents, element: <DocumentsPage /> },
              { path: routes.documentPrint, element: <DocumentPrintPage /> },
              { path: routes.document, element: <DocumentDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.UsersRead} />,
            children: [{ path: routes.users, element: <UsersPage /> }],
          },
          {
            element: <RequirePermission permission={Permission.RolesRead} />,
            children: [
              { path: routes.roles, element: <RolesPage /> },
              { path: routes.role, element: <RoleDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.SettingsRead} />,
            children: [
              { path: routes.settings, element: <SettingsPage /> },
              { path: routes.settingsReferences, element: <ReferencesPage /> },
              { path: routes.settingsReference, element: <ReferenceSetPage /> },
              { path: routes.settingsFields, element: <FieldEntitiesPage /> },
              { path: routes.settingsFieldEntity, element: <EntityFieldsPage /> },
              { path: routes.settingsOrders, element: <OrderWorkflowPage /> },
              { path: routes.settingsOrderStatuses, element: <OrderStatusesPage /> },
              { path: routes.settingsNotifications, element: <NotificationSettingsPage /> },
            ],
          },
          {
            element: <RequirePermission permission={Permission.AuditRead} />,
            children: [
              {
                path: routes.auditLog,
                element: <AuditLogPage />,
              },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
