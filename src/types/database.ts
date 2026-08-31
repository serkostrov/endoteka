export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Row = {
  profiles: {
    id: string
    full_name: string
    email: string
    is_active: boolean
    created_at: string
    updated_at: string
  }
  roles: {
    id: string
    code: string
    name: string
    description: string | null
    created_at: string
    updated_at: string
  }
  permissions: {
    id: string
    code: string
    name: string
    description: string | null
  }
  role_permissions: {
    role_id: string
    permission_id: string
  }
  user_roles: {
    user_id: string
    role_id: string
    assigned_at: string
    assigned_by: string | null
  }
  invitations: {
    id: string
    email: string
    full_name: string
    role_id: string
    invited_by: string
    status: 'pending' | 'accepted' | 'cancelled' | 'failed'
    auth_user_id: string | null
    created_at: string
    accepted_at: string | null
  }
  audit_events: {
    id: string
    actor_id: string | null
    action: string
    entity_type: string
    entity_id: string | null
    metadata: Json
    ip_address: string | null
    user_agent: string | null
    created_at: string
  }
  user_accounts: {
    id: string
    full_name: string
    email: string
    is_active: boolean
    created_at: string
    updated_at: string
    role_id: string | null
    role_code: string | null
    role_name: string | null
  }
  reference_sets: {
    id: string
    code: string
    name: string
    description: string | null
    parent_set_id: string | null
    is_system: boolean
    sort_order: number
    created_at: string
    updated_at: string
  }
  reference_items: {
    id: string
    set_id: string
    parent_id: string | null
    code: string
    name: string
    description: string
    sort_order: number
    is_active: boolean
    is_system: boolean
    created_at: string
    updated_at: string
  }
  field_entities: {
    code: string
    name: string
    description: string | null
    sort_order: number
  }
  dynamic_field_types: {
    code: string
    name: string
    sort_order: number
  }
  dynamic_fields: {
    id: string
    entity_code: string
    code: string
    name: string
    field_type: string
    is_required: boolean
    is_active: boolean
    sort_order: number
    group_name: string
    layout_width: string
    layout_height: string
    created_at: string
    updated_at: string
  }
  dynamic_field_options: {
    id: string
    field_id: string
    code: string
    label: string
    sort_order: number
    is_active: boolean
    created_at: string
    updated_at: string
  }
  dynamic_field_values: {
    id: string
    field_id: string
    entity_code: string
    record_id: string
    value: Json
    created_at: string
    updated_at: string
  }
  reference_set_summaries: {
    id: string
    code: string
    name: string
    description: string | null
    parent_set_id: string | null
    parent_set_code: string | null
    parent_set_name: string | null
    is_system: boolean
    sort_order: number
    created_at: string
    updated_at: string
    item_count: number
    active_item_count: number
  }
  field_entity_summaries: {
    code: string
    name: string
    description: string | null
    sort_order: number
    field_count: number
    active_field_count: number
  }
  customers: {
    id: string
    kind: string
    name: string
    inn: string
    kpp: string
    ogrn: string
    phone: string
    email: string
    city: string
    contact_name: string
    notes: string
    is_active: boolean
    created_at: string
    updated_at: string
  }
  devices: {
    id: string
    customer_id: string | null
    group_id: string | null
    brand_id: string | null
    model_id: string | null
    modification_id: string | null
    serial_number: string
    notes: string
    metadata: Json
    created_at: string
    updated_at: string
  }
  device_list_items: {
    id: string
    serial_number: string
    customer_id: string | null
    group_id: string | null
    brand_id: string | null
    model_id: string | null
    modification_id: string | null
    metadata: Json
    notes: string
    created_at: string
    updated_at: string
    group_name: string
    brand_name: string
    model_name: string
    modification_name: string
    label: string
    warranty_id: string | null
    warranty_start: string | null
    warranty_end: string | null
    warranty_status: string | null
  }
  device_warranties: {
    id: string
    device_id: string
    order_id: string | null
    starts_on: string
    ends_on: string
    created_by: string | null
    created_at: string
  }
  orders: {
    id: string
    number: string
    number_seq: number
    customer_id: string
    device_id: string
    serial_number: string
    claimed_malfunction: string
    completeness: string
    external_condition: string
    deadline: string | null
    responsible_id: string | null
    status_id: string
    created_by: string | null
    created_at: string
    updated_at: string
  }
  order_list_items: {
    id: string
    number: string
    number_seq: number
    customer_id: string
    customer_name: string
    device_id: string
    serial_number: string
    device_brand: string
    device_model: string
    device_label: string
    status_id: string
    status_code: string
    status_name: string
    is_terminal: boolean
    responsible_id: string | null
    responsible_name: string
    deadline: string | null
    deadline_state: string
    claimed_malfunction: string
    created_at: string
    updated_at: string
  }
  order_status_events: {
    id: string
    order_id: string
    from_status_id: string | null
    to_status_id: string
    actor_id: string | null
    metadata: Json
    created_at: string
  }
  order_diagnostics: {
    order_id: string
    engineer_id: string | null
    conclusion: string
    created_at: string
    created_by: string | null
    updated_by: string | null
    updated_at: string
  }
  order_journal_events: {
    id: string
    order_id: string
    event_type: string
    actor_id: string | null
    summary: string
    payload: Json
    created_at: string
  }
  order_diagnostics_items: {
    order_id: string
    engineer_id: string | null
    engineer_name: string
    conclusion: string
    created_at: string
    created_by: string | null
    updated_at: string
    updated_by: string | null
    updated_by_name: string
  }
  order_attachments: {
    id: string
    order_id: string
    kind: 'photo' | 'pdf' | 'url'
    file_path: string | null
    file_name: string | null
    mime_type: string | null
    file_size: number | null
    url: string | null
    caption: string
    created_by: string | null
    created_at: string
  }
  notifications: {
    id: string
    event_code: string
    title: string
    body: string
    entity_type: string | null
    entity_id: string | null
    payload: Json
    created_at: string
  }
  notification_recipients: {
    id: string
    notification_id: string
    recipient_id: string
    is_read: boolean
    read_at: string | null
    created_at: string
  }
  notification_rules: {
    id: string
    event_code: string
    target_kind: string
    role_id: string | null
    channel_in_app: boolean
    channel_email: boolean
    channel_telegram: boolean
    is_active: boolean
  }
  notification_deliveries: {
    id: string
    notification_id: string
    recipient_id: string
    channel: string
    status: string
    attempts: number
    error: string | null
    sent_at: string | null
    claimed_at: string | null
    created_at: string
  }
  notification_event_catalog: {
    code: string
    name: string
    description: string
    sort_order: number
    is_system: boolean
  }
  telegram_links: {
    user_id: string
    chat_id: string | null
    telegram_username: string | null
    link_code: string | null
    link_code_expires_at: string | null
    linked_at: string | null
  }
  domain_events: {
    id: string
    event_code: string
    entity_type: string | null
    entity_id: string | null
    payload: Json
    actor_id: string | null
    created_at: string
    processed_at: string | null
    process_error: string | null
  }
  order_status_transitions: {
    id: string
    from_status_id: string
    to_status_id: string
    required_permission: string
    is_active: boolean
    sort_order: number
    created_at: string
    updated_at: string
  }
  order_transition_rules: {
    transition_id: string
    rule_code: string
  }
  order_status_meta: {
    status_id: string
    is_initial: boolean
    is_terminal: boolean
    notifies_warehouse: boolean
    group_id: string | null
    color: string
    requires_warranty: boolean
    is_destructive: boolean
  }
  order_status_groups: {
    id: string
    code: string
    name: string
    color: string
    sort_order: number
    created_at: string
  }
  order_status_catalog: {
    id: string
    code: string
    name: string
    is_active: boolean
    is_system: boolean
    sort_order: number
    group_id: string | null
    group_code: string | null
    group_name: string | null
    group_sort_order: number | null
    group_color: string | null
    color: string | null
    is_initial: boolean
    is_terminal: boolean
    notifies_warehouse: boolean
    requires_warranty: boolean
    is_destructive: boolean
  }
  app_settings: {
    key: string
    value: Json
    updated_at: string
  }
  order_number_sequence: {
    id: number
    prefix: string
    pad_width: number
    start_value: number
    last_value: number
  }
  transition_rule_types: {
    code: string
    name: string
    description: string | null
  }
  inventory_items: {
    id: string
    code: string
    article: string
    barcode: string
    name: string
    category_id: string
    unit_id: string
    purchase_price: number
    repair_price: number
    retail_price: number
    created_at: string
    updated_at: string
  }
  inventory_receipts: {
    id: string
    supplier: string
    supplier_id: string | null
    receipt_date: string
    notes: string
    created_by: string | null
    created_at: string
  }
  inventory_sales: {
    id: string
    invoice_number: string
    notes: string
    created_by: string | null
    created_at: string
  }
  inventory_adjustments: {
    id: string
    reason: string
    created_by: string | null
    created_at: string
  }
  inventory_batches: {
    id: string
    item_id: string
    receipt_id: string | null
    supplier: string
    receipt_date: string
    purchase_price: number
    quantity: number
    remaining_quantity: number
    created_at: string
  }
  inventory_movements: {
    id: string
    item_id: string
    batch_id: string
    quantity: number
    unit_price: number
    movement_type: string
    reference_type: string
    reference_id: string
    created_by: string | null
    created_at: string
  }
  order_part_lines: {
    id: string
    order_id: string
    item_id: string
    quantity: number
    unit_price: number
    created_by: string | null
    created_at: string
    updated_at: string
  }
  service_templates: {
    id: string
    name: string
    description: string
    unit_price: number
    is_active: boolean
    created_by: string | null
    created_at: string
    updated_at: string
  }
  order_service_lines: {
    id: string
    order_id: string
    template_id: string | null
    name: string
    quantity: number
    unit_price: number
    created_by: string | null
    created_at: string
    updated_at: string
  }
  inventory_counts: {
    id: string
    number: string
    status: string
    created_by: string | null
    created_at: string
    completed_at: string | null
  }
  inventory_count_lines: {
    id: string
    count_id: string
    item_id: string
    expected_quantity: number
    actual_quantity: number | null
    difference: number | null
    created_at: string
  }
  sales: {
    id: string
    invoice_number: string
    customer_id: string | null
    created_by: string | null
    sale_date: string
    status: string
    total: number
    created_at: string
    confirmed_at: string | null
  }
  sale_lines: {
    id: string
    sale_id: string
    item_id: string
    quantity: number
    unit_price: number
    amount: number
    sort_order: number
    created_at: string
  }
  sale_allocations: {
    id: string
    sale_id: string
    line_id: string
    batch_id: string
    movement_id: string
    quantity: number
    unit_cost: number
    created_at: string
  }
  document_templates: {
    id: string
    code: string
    name: string
    kind: string
    page_size: string
    body: Json
    is_system: boolean
    created_by: string | null
    created_at: string
    updated_at: string
  }
  documents: {
    id: string
    number: string
    template_id: string
    title: string
    kind: string
    source_type: string
    source_id: string | null
    status: string
    body: Json
    context: Json
    created_by: string | null
    created_at: string
    issued_at: string | null
  }
  tasks: {
    id: string
    title: string
    body: string
    assignee_id: string | null
    due_date: string | null
    priority: string
    completed: boolean
    order_id: string | null
    created_by: string | null
    created_at: string
    completed_at: string | null
  }
  import_runs: {
    id: string
    phase: string
    status: string
    dry_run: boolean
    source_dir: string
    totals: Json
    started_at: string
    finished_at: string | null
    error_message: string | null
  }
  import_source_keys: {
    dataset: string
    source_key: string
    entity_type: string
    entity_id: string
    payload_hash: string
    last_run_id: string | null
    created_at: string
    updated_at: string
  }
  import_row_results: {
    id: string
    run_id: string
    dataset: string
    row_number: number
    source_key: string | null
    status: string
    missing_fields: string[]
    error_code: string | null
    error_message: string | null
    payload: Json
    created_at: string
  }
}

/**
 * Hand-written until `supabase gen types` is wired to the live project.
 * Keep this in sync with `supabase/migrations`.
 */
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Row['profiles']
        Insert: {
          id: string
          full_name?: string
          email?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          full_name?: string
          email?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      roles: {
        Row: Row['roles']
        Insert: {
          id?: string
          code: string
          name: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          code?: string
          name?: string
          description?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: Row['permissions']
        Insert: {
          id?: string
          code: string
          name: string
          description?: string | null
        }
        Update: {
          code?: string
          name?: string
          description?: string | null
        }
        Relationships: []
      }
      role_permissions: {
        Row: Row['role_permissions']
        Insert: {
          role_id: string
          permission_id: string
        }
        Update: never
        Relationships: []
      }
      user_roles: {
        Row: Row['user_roles']
        Insert: {
          user_id: string
          role_id: string
          assigned_at?: string
          assigned_by?: string | null
        }
        Update: never
        Relationships: []
      }
      invitations: {
        Row: Row['invitations']
        Insert: {
          id?: string
          email: string
          full_name?: string
          role_id: string
          invited_by: string
          status?: Row['invitations']['status']
          auth_user_id?: string | null
          created_at?: string
          accepted_at?: string | null
        }
        Update: {
          status?: Row['invitations']['status']
          auth_user_id?: string | null
          accepted_at?: string | null
        }
        Relationships: []
      }
      audit_events: {
        Row: Row['audit_events']
        Insert: {
          id?: string
          actor_id?: string | null
          action: string
          entity_type: string
          entity_id?: string | null
          metadata?: Json
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: never
        Relationships: []
      }
      reference_sets: {
        Row: Row['reference_sets']
        Insert: {
          id?: string
          code: string
          name: string
          description?: string | null
          parent_set_id?: string | null
          is_system?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      reference_items: {
        Row: Row['reference_items']
        Insert: {
          id?: string
          set_id: string
          parent_id?: string | null
          code: string
          name: string
          description?: string
          sort_order?: number
          is_active?: boolean
          is_system?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          parent_id?: string | null
          code?: string
          name?: string
          description?: string
          sort_order?: number
          is_active?: boolean
        }
        Relationships: []
      }
      field_entities: {
        Row: Row['field_entities']
        Insert: {
          code: string
          name: string
          description?: string | null
          sort_order?: number
        }
        Update: {
          name?: string
          description?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      dynamic_field_types: {
        Row: Row['dynamic_field_types']
        Insert: {
          code: string
          name: string
          sort_order?: number
        }
        Update: {
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      dynamic_fields: {
        Row: Row['dynamic_fields']
        Insert: {
          id?: string
          entity_code: string
          code: string
          name: string
          field_type: string
          is_required?: boolean
          is_active?: boolean
          sort_order?: number
          group_name?: string
          layout_width?: string
          layout_height?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          code?: string
          name?: string
          field_type?: string
          is_required?: boolean
          is_active?: boolean
          sort_order?: number
          group_name?: string
          layout_width?: string
          layout_height?: string
        }
        Relationships: []
      }
      dynamic_field_options: {
        Row: Row['dynamic_field_options']
        Insert: {
          id?: string
          field_id: string
          code: string
          label: string
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          label?: string
          sort_order?: number
          is_active?: boolean
        }
        Relationships: []
      }
      dynamic_field_values: {
        Row: Row['dynamic_field_values']
        Insert: {
          id?: string
          field_id: string
          entity_code: string
          record_id: string
          value?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          value?: Json
        }
        Relationships: []
      }
      customers: {
        Row: Row['customers']
        Insert: {
          id?: string
          kind?: string
          name: string
          inn?: string
          kpp?: string
          ogrn?: string
          phone?: string
          email?: string
          city?: string
          contact_name?: string
          notes?: string
          is_active?: boolean
        }
        Update: {
          kind?: string
          name?: string
          inn?: string
          kpp?: string
          ogrn?: string
          phone?: string
          email?: string
          city?: string
          contact_name?: string
          notes?: string
          is_active?: boolean
        }
        Relationships: []
      }
      devices: {
        Row: Row['devices']
        Insert: {
          id?: string
          customer_id?: string | null
          group_id?: string | null
          brand_id?: string | null
          model_id?: string | null
          modification_id?: string | null
          serial_number: string
          notes?: string
          metadata?: Json
        }
        Update: {
          customer_id?: string | null
          serial_number?: string
          notes?: string
          metadata?: Json
        }
        Relationships: []
      }
      orders: {
        Row: Row['orders']
        Insert: never
        Update: never
        Relationships: []
      }
      order_status_events: {
        Row: Row['order_status_events']
        Insert: never
        Update: never
        Relationships: []
      }
      order_diagnostics: {
        Row: Row['order_diagnostics']
        Insert: never
        Update: never
        Relationships: []
      }
      order_journal_events: {
        Row: Row['order_journal_events']
        Insert: never
        Update: never
        Relationships: []
      }
      order_attachments: {
        Row: Row['order_attachments']
        Insert: never
        Update: never
        Relationships: []
      }
      notifications: {
        Row: Row['notifications']
        Insert: never
        Update: never
        Relationships: []
      }
      notification_recipients: {
        Row: Row['notification_recipients']
        Insert: never
        Update: never
        Relationships: []
      }
      notification_rules: {
        Row: Row['notification_rules']
        Insert: never
        Update: never
        Relationships: []
      }
      notification_deliveries: {
        Row: Row['notification_deliveries']
        Insert: never
        Update: never
        Relationships: []
      }
      notification_event_catalog: {
        Row: Row['notification_event_catalog']
        Insert: never
        Update: never
        Relationships: []
      }
      telegram_links: {
        Row: Row['telegram_links']
        Insert: never
        Update: never
        Relationships: []
      }
      domain_events: {
        Row: Row['domain_events']
        Insert: never
        Update: never
        Relationships: []
      }
      order_status_transitions: {
        Row: Row['order_status_transitions']
        Insert: never
        Update: never
        Relationships: []
      }
      order_transition_rules: {
        Row: Row['order_transition_rules']
        Insert: never
        Update: never
        Relationships: []
      }
      order_status_meta: {
        Row: Row['order_status_meta']
        Insert: never
        Update: never
        Relationships: []
      }
      order_status_groups: {
        Row: Row['order_status_groups']
        Insert: never
        Update: never
        Relationships: []
      }
      app_settings: {
        Row: Row['app_settings']
        Insert: never
        Update: never
        Relationships: []
      }
      order_number_sequence: {
        Row: Row['order_number_sequence']
        Insert: never
        Update: never
        Relationships: []
      }
      device_warranties: {
        Row: Row['device_warranties']
        Insert: never
        Update: never
        Relationships: []
      }
      transition_rule_types: {
        Row: Row['transition_rule_types']
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_items: {
        Row: Row['inventory_items']
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_receipts: {
        Row: Row['inventory_receipts']
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_sales: {
        Row: Row['inventory_sales']
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_adjustments: {
        Row: Row['inventory_adjustments']
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_batches: {
        Row: Row['inventory_batches']
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_movements: {
        Row: Row['inventory_movements']
        Insert: never
        Update: never
        Relationships: []
      }
      order_part_lines: {
        Row: Row['order_part_lines']
        Insert: never
        Update: never
        Relationships: []
      }
      service_templates: {
        Row: Row['service_templates']
        Insert: never
        Update: never
        Relationships: []
      }
      order_service_lines: {
        Row: Row['order_service_lines']
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_counts: {
        Row: Row['inventory_counts']
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_count_lines: {
        Row: Row['inventory_count_lines']
        Insert: never
        Update: never
        Relationships: []
      }
      sales: {
        Row: Row['sales']
        Insert: never
        Update: never
        Relationships: []
      }
      sale_lines: {
        Row: Row['sale_lines']
        Insert: never
        Update: never
        Relationships: []
      }
      sale_allocations: {
        Row: Row['sale_allocations']
        Insert: never
        Update: never
        Relationships: []
      }
      document_templates: {
        Row: Row['document_templates']
        Insert: never
        Update: never
        Relationships: []
      }
      documents: {
        Row: Row['documents']
        Insert: never
        Update: never
        Relationships: []
      }
      tasks: {
        Row: Row['tasks']
        Insert: never
        Update: never
        Relationships: []
      }
      import_runs: {
        Row: Row['import_runs']
        Insert: {
          id?: string
          phase: string
          status: string
          dry_run?: boolean
          source_dir?: string
          totals?: Json
          started_at?: string
          finished_at?: string | null
          error_message?: string | null
        }
        Update: {
          status?: string
          totals?: Json
          finished_at?: string | null
          error_message?: string | null
        }
        Relationships: []
      }
      import_source_keys: {
        Row: Row['import_source_keys']
        Insert: {
          dataset: string
          source_key: string
          entity_type: string
          entity_id: string
          payload_hash: string
          last_run_id?: string | null
        }
        Update: {
          entity_id?: string
          payload_hash?: string
          last_run_id?: string | null
        }
        Relationships: []
      }
      import_row_results: {
        Row: Row['import_row_results']
        Insert: {
          id?: string
          run_id: string
          dataset: string
          row_number: number
          source_key?: string | null
          status: string
          missing_fields?: string[]
          error_code?: string | null
          error_message?: string | null
          payload?: Json
        }
        Update: never
        Relationships: []
      }
    }
    Views: {
      user_accounts: {
        Row: Row['user_accounts']
        Relationships: []
      }
      reference_set_summaries: {
        Row: Row['reference_set_summaries']
        Relationships: []
      }
      field_entity_summaries: {
        Row: Row['field_entity_summaries']
        Relationships: []
      }
      order_list_items: {
        Row: Row['order_list_items']
        Relationships: []
      }
      device_list_items: {
        Row: Row['device_list_items']
        Relationships: []
      }
      order_diagnostics_items: {
        Row: Row['order_diagnostics_items']
        Relationships: []
      }
      order_status_catalog: {
        Row: Row['order_status_catalog']
        Relationships: []
      }
    }
    Functions: {
      has_permission: {
        Args: { permission_code: string }
        Returns: boolean
      }
      has_role: {
        Args: { role_code: string }
        Returns: boolean
      }
      can_assign_role: {
        Args: { target_role_id: string }
        Returns: boolean
      }
      get_my_roles: {
        Args: Record<PropertyKey, never>
        Returns: { code: string }[]
      }
      get_my_permissions: {
        Args: Record<PropertyKey, never>
        Returns: { code: string }[]
      }
      get_assignable_roles: {
        Args: Record<PropertyKey, never>
        Returns: { id: string; code: string; name: string; description: string | null }[]
      }
      assign_user_role: {
        Args: { target_user_id: string; target_role_id: string }
        Returns: undefined
      }
      set_user_active: {
        Args: { target_user_id: string; next_active: boolean }
        Returns: undefined
      }
      update_user_account: {
        Args: {
          target_user_id: string
          next_full_name: string
          target_role_id: string
          next_active: boolean
        }
        Returns: undefined
      }
      prepare_delete_user: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      record_user_password_changed: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      set_role_permissions: {
        Args: { target_role_id: string; permission_codes: string[] }
        Returns: undefined
      }
      create_invitation: {
        Args: { target_email: string; target_full_name: string; target_role_id: string }
        Returns: string
      }
      fail_invitation: {
        Args: { target_invitation_id: string; reason: string }
        Returns: undefined
      }
      reference_item_usage_count: {
        Args: { target_item_id: string }
        Returns: number
      }
      dynamic_field_usage_count: {
        Args: { target_field_id: string }
        Returns: number
      }
      dynamic_option_usage_count: {
        Args: { target_field_id: string; option_code: string }
        Returns: number
      }
      validate_dynamic_field_value: {
        Args: { target_field_id: string; raw: Json }
        Returns: undefined
      }
      upsert_reference_item: {
        Args: {
          target_id: string | null
          target_set_id: string
          item_code: string
          item_name: string
          item_description?: string
          parent_item_id?: string | null
        }
        Returns: string
      }
      set_reference_item_active: {
        Args: { target_id: string; next_active: boolean }
        Returns: undefined
      }
      delete_reference_item: {
        Args: { target_id: string }
        Returns: undefined
      }
      reorder_reference_items: {
        Args: { target_set_id: string; item_ids: string[] }
        Returns: undefined
      }
      upsert_dynamic_field: {
        Args: {
          target_id: string | null
          entity_code: string
          field_code: string
          field_name: string
          field_type: string
          is_required?: boolean
          options?: Json
          group_name?: string
          layout_width?: string
          layout_height?: string
        }
        Returns: string
      }
      set_dynamic_field_layout: {
        Args: { target_id: string; next_width: string; next_height: string }
        Returns: undefined
      }
      set_dynamic_field_active: {
        Args: { target_id: string; next_active: boolean }
        Returns: undefined
      }
      delete_dynamic_field: {
        Args: { target_id: string }
        Returns: undefined
      }
      reorder_dynamic_fields: {
        Args: { target_entity_code: string; field_ids: string[] }
        Returns: undefined
      }
      save_dynamic_field_values: {
        Args: { target_entity_code: string; target_record_id: string; field_values: Json }
        Returns: undefined
      }
      preview_next_order_number: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      set_order_number_start: {
        Args: { next_start: number }
        Returns: undefined
      }
      create_customer: {
        Args: {
          customer_name: string
          customer_kind?: string
          customer_inn?: string
          customer_kpp?: string
          customer_ogrn?: string
          customer_phone?: string
          customer_email?: string
          customer_city?: string
          customer_contact_name?: string
          customer_notes?: string
        }
        Returns: string
      }
      update_customer: {
        Args: {
          target_customer_id: string
          customer_name: string
          customer_kind?: string
          customer_inn?: string
          customer_kpp?: string
          customer_ogrn?: string
          customer_phone?: string
          customer_email?: string
          customer_city?: string
          customer_contact_name?: string
          customer_notes?: string
        }
        Returns: undefined
      }
      delete_customer: {
        Args: { target_customer_id: string }
        Returns: undefined
      }
      search_customers: {
        Args: {
          search_query?: string
          page_number?: number
          page_size?: number
          active_only?: boolean
          kind_filter?: string | null
        }
        Returns: {
          id: string
          kind: string
          name: string
          inn: string
          kpp: string
          ogrn: string
          phone: string
          email: string
          city: string
          contact_name: string
          notes: string
          is_active: boolean
          created_at: string
          updated_at: string
          total_count: number
        }[]
      }
      find_customers_by_inn: {
        Args: { inn_query: string; exclude_id?: string | null }
        Returns: { id: string; name: string; kind: string; inn: string }[]
      }
      get_customer_card: {
        Args: { target_customer_id: string }
        Returns: Json
      }
      create_device: {
        Args: {
          device_serial: string
          device_customer_id?: string | null
          device_group_id?: string | null
          device_brand_id?: string | null
          device_model_id?: string | null
          device_modification_id?: string | null
        }
        Returns: string
      }
      update_device: {
        Args: {
          target_device_id: string
          device_group_id?: string | null
          device_brand_id?: string | null
          device_model_id?: string | null
          device_modification_id?: string | null
          device_metadata?: Json
        }
        Returns: undefined
      }
      delete_device: {
        Args: { target_device_id: string }
        Returns: undefined
      }
      search_device_serial: {
        Args: { serial_query: string }
        Returns: Json
      }
      get_device_card: {
        Args: { target_device_id: string }
        Returns: Json
      }
      get_warranty_defaults: {
        Args: Record<PropertyKey, never>
        Returns: { starts_on: string; ends_on: string; default_months: number }[]
      }
      create_order: {
        Args: {
          target_customer_id: string
          target_device_id: string
          claimed_malfunction: string
          completeness?: string
          external_condition?: string
          target_deadline?: string | null
          target_responsible_id?: string | null
        }
        Returns: string
      }
      delete_order: {
        Args: { target_order_id: string }
        Returns: undefined
      }
      delete_order_attachment: {
        Args: { target_attachment_id: string }
        Returns: undefined
      }
      update_order: {
        Args: {
          target_order_id: string
          claimed_malfunction?: string | null
          completeness?: string | null
          external_condition?: string | null
          target_deadline?: string | null
          clear_deadline?: boolean
          target_responsible_id?: string | null
          change_responsible?: boolean
          target_customer_id?: string | null
          change_customer?: boolean
          target_device_id?: string | null
          change_device?: boolean
        }
        Returns: undefined
      }
      change_order_status: {
        Args: {
          target_order_id: string
          target_status_id: string
          warranty_start?: string | null
          warranty_end?: string | null
        }
        Returns: undefined
      }
      get_available_order_transitions: {
        Args: { target_order_id: string }
        Returns: {
          transition_id: string
          to_status_id: string
          to_status_code: string
          to_status_name: string
          required_permission: string
          is_allowed: boolean
          block_reason: string | null
          group_code: string | null
          group_name: string | null
          group_sort_order: number | null
          color: string | null
          requires_warranty: boolean
          is_destructive: boolean
        }[]
      }
      save_order_diagnostics: {
        Args: {
          target_order_id: string
          conclusion?: string
          target_engineer_id?: string | null
          field_values?: Json
        }
        Returns: undefined
      }
      get_order_journal: {
        Args: { target_order_id: string }
        Returns: {
          id: string
          event_type: string
          summary: string
          actor_id: string | null
          actor_name: string
          payload: Json
          created_at: string
        }[]
      }
      add_order_journal_note: {
        Args: { target_order_id: string; p_body: string }
        Returns: string
      }
      add_order_attachment_url: {
        Args: { target_order_id: string; target_url: string; caption?: string }
        Returns: string
      }
      register_order_file: {
        Args: {
          target_order_id: string
          file_path: string
          file_name: string
          mime_type: string
          file_size: number
          caption?: string
        }
        Returns: string
      }
      upsert_order_transition: {
        Args: {
          target_id: string | null
          from_status_id: string
          to_status_id: string
          required_permission: string
          rule_codes?: string[]
          is_active?: boolean
        }
        Returns: string
      }
      delete_order_transition: {
        Args: { target_id: string }
        Returns: undefined
      }
      upsert_order_status_group: {
        Args: {
          target_id?: string | null
          group_code: string
          group_name: string
          group_color: string
          group_sort?: number | null
        }
        Returns: string
      }
      delete_order_status_group: {
        Args: { target_id: string }
        Returns: undefined
      }
      upsert_order_status: {
        Args: {
          target_id?: string | null
          item_code: string
          item_name: string
          target_group_id: string
          item_color?: string
          p_initial?: boolean
          p_terminal?: boolean
          p_warehouse?: boolean
          p_warranty?: boolean
          p_destructive?: boolean
          p_active?: boolean
        }
        Returns: string
      }
      delete_order_status: {
        Args: { target_id: string }
        Returns: undefined
      }
      reorder_order_statuses: {
        Args: { item_ids: string[] }
        Returns: undefined
      }
      reorder_order_status_groups: {
        Args: { group_ids: string[] }
        Returns: undefined
      }
      process_order_deadline_notifications: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      list_my_notifications: {
        Args: { page_size?: number }
        Returns: {
          id: string
          event_code: string
          title: string
          body: string
          entity_type: string | null
          entity_id: string | null
          is_read: boolean
          created_at: string
        }[]
      }
      count_unread_notifications: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      get_operational_dashboard: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      mark_notifications_read: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      mark_notification_read: {
        Args: { target_notification_id: string }
        Returns: undefined
      }
      list_notification_admin: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      upsert_notification_rule: {
        Args: {
          target_id?: string | null
          p_event_code: string
          p_target_kind: string
          p_role_id?: string | null
          p_channel_in_app?: boolean
          p_channel_email?: boolean
          p_channel_telegram?: boolean
          p_is_active?: boolean
        }
        Returns: string
      }
      delete_notification_rule: {
        Args: { target_id: string }
        Returns: undefined
      }
      save_notification_channel_settings: {
        Args: {
          p_email_enabled: boolean
          p_from_name: string
          p_from_email: string
          p_telegram_enabled: boolean
          p_telegram_bot_username: string
        }
        Returns: undefined
      }
      get_my_telegram_link: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      create_telegram_link_code: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      unlink_telegram: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      list_active_employees: {
        Args: Record<PropertyKey, never>
        Returns: { id: string; full_name: string; email: string }[]
      }
      create_inventory_item: {
        Args: {
          item_name: string
          item_code?: string
          item_article?: string
          item_barcode?: string
          item_category_id?: string
          item_unit_id?: string
          item_purchase_price?: number
          item_repair_price?: number
          item_retail_price?: number
        }
        Returns: string
      }
      update_inventory_item: {
        Args: {
          target_item_id: string
          item_name: string
          item_code?: string
          item_article?: string
          item_barcode?: string
          item_category_id?: string
          item_unit_id?: string
          item_purchase_price?: number
          item_repair_price?: number
          item_retail_price?: number
        }
        Returns: undefined
      }
      delete_inventory_item: {
        Args: { target_item_id: string }
        Returns: undefined
      }
      search_inventory_items: {
        Args: { search_query?: string; page_number?: number; page_size?: number; stock_filter?: string }
        Returns: {
          id: string
          code: string
          article: string
          barcode: string
          name: string
          category_id: string
          category_name: string
          unit_id: string
          unit_name: string
          purchase_price: number
          repair_price: number
          retail_price: number
          stock_quantity: number
          created_at: string
          updated_at: string
          total_count: number
        }[]
      }
      find_inventory_item_by_name: {
        Args: { name_query: string; exclude_id?: string | null }
        Returns: { id: string; name: string; code: string }[]
      }
      find_inventory_items_by_barcode: {
        Args: { barcode_query: string }
        Returns: {
          id: string
          code: string
          article: string
          barcode: string
          name: string
          category_id: string
          category_name: string
          unit_id: string
          unit_name: string
          purchase_price: number
          repair_price: number
          retail_price: number
          stock_quantity: number
          created_at: string
          updated_at: string
          total_count: number
        }[]
      }
      receive_inventory: {
        Args: {
          supplier_name: string
          doc_receipt_date: string
          doc_notes: string
          lines: Json
          supplier_customer_id?: string | null
        }
        Returns: string
      }
      consume_inventory_for_order: {
        Args: {
          target_order_id: string
          target_item_id: string
          consume_quantity: number
          line_unit_price?: number | null
        }
        Returns: Json
      }
      consume_inventory_for_sale: {
        Args: {
          target_item_id: string
          consume_quantity: number
          invoice_number?: string
          sale_notes?: string
        }
        Returns: string
      }
      adjust_inventory: {
        Args: { target_item_id: string; quantity_delta: number; reason_text: string }
        Returns: string
      }
      get_inventory_item_card: {
        Args: { target_item_id: string }
        Returns: Json
      }
      list_inventory_receipts: {
        Args: { page_number?: number; page_size?: number }
        Returns: {
          id: string
          supplier: string
          supplier_id: string | null
          receipt_date: string
          notes: string
          created_at: string
          actor_name: string
          line_count: number
          total_quantity: number
          total_count: number
        }[]
      }
      get_inventory_receipt: {
        Args: { target_receipt_id: string }
        Returns: Json
      }
      delete_inventory_receipt: {
        Args: { target_receipt_id: string; delete_mode: string }
        Returns: undefined
      }
      list_inventory_adjustments: {
        Args: { page_number?: number; page_size?: number }
        Returns: {
          id: string
          reason: string
          created_at: string
          actor_name: string
          item_name: string
          quantity: number
          total_count: number
        }[]
      }
      get_order_inventory_usage: {
        Args: { target_order_id: string }
        Returns: Json
      }
      set_order_part_line: {
        Args: { target_line_id: string; line_quantity: number; line_unit_price: number }
        Returns: undefined
      }
      remove_order_part_line: {
        Args: { target_line_id: string }
        Returns: undefined
      }
      create_inventory_count: {
        Args: { seed_mode?: string; seed_item_id?: string | null }
        Returns: string
      }
      start_inventory_count: {
        Args: { target_count_id: string }
        Returns: undefined
      }
      cancel_inventory_count: {
        Args: { target_count_id: string }
        Returns: undefined
      }
      add_inventory_count_item: {
        Args: { target_count_id: string; target_item_id: string }
        Returns: string
      }
      remove_inventory_count_line: {
        Args: { target_line_id: string }
        Returns: undefined
      }
      set_inventory_count_line_actual: {
        Args: { target_line_id: string; next_actual: number }
        Returns: undefined
      }
      increment_inventory_count_item: {
        Args: { target_count_id: string; target_item_id: string; increment_by?: number }
        Returns: string
      }
      complete_inventory_count: {
        Args: { target_count_id: string }
        Returns: undefined
      }
      delete_inventory_count: {
        Args: { target_count_id: string }
        Returns: undefined
      }
      list_inventory_counts: {
        Args: { status_filter?: string; page_number?: number; page_size?: number }
        Returns: {
          id: string
          number: string
          status: string
          created_by: string | null
          created_at: string
          completed_at: string | null
          actor_name: string
          line_count: number
          counted_count: number
          discrepancy_count: number
          total_count: number
        }[]
      }
      get_inventory_count: {
        Args: { target_count_id: string }
        Returns: Json
      }
      list_inventory_count_lines: {
        Args: {
          target_count_id: string
          search_query?: string
          line_filter?: string
          page_number?: number
          page_size?: number
        }
        Returns: {
          id: string
          item_id: string
          item_name: string
          item_code: string
          item_article: string
          item_barcode: string
          unit_name: string
          expected_quantity: number
          actual_quantity: number | null
          difference: number | null
          created_at: string
          total_count: number
        }[]
      }
      get_inventory_count_statement: {
        Args: { target_count_id: string }
        Returns: Json
      }
      preview_inventory_fifo: {
        Args: { target_item_id: string; consume_quantity: number }
        Returns: Json
      }
      create_sale: {
        Args: {
          p_customer_id?: string | null
          p_sale_date?: string | null
          p_invoice_number?: string | null
          p_seed_item_id?: string | null
        }
        Returns: string
      }
      update_sale: {
        Args: {
          target_sale_id: string
          p_customer_id?: string | null
          p_sale_date?: string | null
          p_invoice_number?: string | null
        }
        Returns: undefined
      }
      add_sale_line: {
        Args: {
          target_sale_id: string
          target_item_id: string
          line_quantity: number
          line_unit_price?: number | null
        }
        Returns: string
      }
      set_sale_line: {
        Args: { target_line_id: string; line_quantity: number; line_unit_price: number }
        Returns: undefined
      }
      remove_sale_line: {
        Args: { target_line_id: string }
        Returns: undefined
      }
      confirm_sale: {
        Args: { target_sale_id: string }
        Returns: undefined
      }
      cancel_sale: {
        Args: { target_sale_id: string }
        Returns: undefined
      }
      delete_sale: {
        Args: { target_sale_id: string }
        Returns: undefined
      }
      list_sales: {
        Args: {
          search_query?: string
          status_filter?: string
          page_number?: number
          page_size?: number
        }
        Returns: {
          id: string
          invoice_number: string
          customer_id: string | null
          customer_name: string
          created_by: string | null
          created_by_name: string
          sale_date: string
          status: string
          total: number
          created_at: string
          confirmed_at: string | null
          total_count: number
        }[]
      }
      get_sale: {
        Args: { target_sale_id: string }
        Returns: Json
      }
      get_document_context: {
        Args: { p_source_type: string; p_source_id?: string | null }
        Returns: Json
      }
      list_document_templates: {
        Args: { kind_filter?: string; search_query?: string }
        Returns: {
          id: string
          code: string
          name: string
          kind: string
          page_size: string
          is_system: boolean
          updated_at: string
        }[]
      }
      get_document_template: {
        Args: { target_template_id: string }
        Returns: Json
      }
      create_document_template: {
        Args: {
          template_name: string
          template_kind: string
          template_page_size?: string
          template_body?: Json
        }
        Returns: string
      }
      update_document_template: {
        Args: {
          target_template_id: string
          template_name: string
          template_kind: string
          template_page_size: string
          template_body: Json
        }
        Returns: undefined
      }
      delete_document_template: {
        Args: { target_template_id: string }
        Returns: undefined
      }
      list_documents: {
        Args: {
          search_query?: string
          kind_filter?: string
          source_type_filter?: string
          source_id_filter?: string | null
          page_number?: number
          page_size?: number
        }
        Returns: {
          id: string
          number: string
          title: string
          kind: string
          source_type: string
          source_id: string | null
          source_label: string
          status: string
          created_by_name: string
          created_at: string
          issued_at: string | null
          total_count: number
        }[]
      }
      get_document: {
        Args: { target_document_id: string }
        Returns: Json
      }
      create_document: {
        Args: {
          target_template_id: string
          p_source_type?: string
          p_source_id?: string | null
        }
        Returns: string
      }
      issue_document: {
        Args: { target_document_id: string }
        Returns: undefined
      }
      list_tasks: {
        Args: {
          search_query?: string
          assignee_filter?: string
          status_filter?: string
          priority_filter?: string
          due_filter?: string
          linked_filter?: string
          order_id_filter?: string | null
          page_number?: number
          page_size?: number
        }
        Returns: {
          id: string
          title: string
          assignee_id: string | null
          assignee_name: string
          due_date: string | null
          priority: string
          completed: boolean
          order_id: string | null
          order_number: string
          created_by: string | null
          created_by_name: string
          created_at: string
          completed_at: string | null
          total_count: number
        }[]
      }
      get_task: {
        Args: { target_task_id: string }
        Returns: Json
      }
      count_open_tasks: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      create_task: {
        Args: {
          p_title: string
          p_body?: string
          p_assignee_id?: string | null
          p_due_date?: string | null
          p_priority?: string
          p_order_id?: string | null
        }
        Returns: string
      }
      update_task: {
        Args: {
          target_task_id: string
          p_title: string
          p_body?: string
          p_assignee_id?: string | null
          p_due_date?: string | null
          p_priority?: string
        }
        Returns: undefined
      }
      set_task_completed: {
        Args: { target_task_id: string; p_completed: boolean }
        Returns: undefined
      }
      delete_task: {
        Args: { target_task_id: string }
        Returns: undefined
      }
      record_auth_event: {
        Args: { event_action: string }
        Returns: undefined
      }
      list_audit_events: {
        Args: {
          search_query?: string
          actor_filter?: string | null
          entity_type_filter?: string
          action_filter?: string
          from_date?: string | null
          to_date?: string | null
          page_number?: number
          page_size?: number
        }
        Returns: {
          id: string
          actor_id: string | null
          actor_name: string
          actor_email: string
          action: string
          entity_type: string
          entity_id: string | null
          metadata: Json
          ip_address: string | null
          user_agent: string | null
          created_at: string
          total_count: number
        }[]
      }
      consume_inventory_fifo: {
        Args: {
          target_item_id: string
          consume_quantity: number
          target_movement_type: string
          target_reference_type: string
          target_reference_id: string
        }
        Returns: Json
      }
      search_service_templates: {
        Args: {
          search_query?: string
          page_number?: number
          page_size?: number
          active_only?: boolean
        }
        Returns: {
          id: string
          name: string
          description: string
          unit_price: number
          is_active: boolean
          created_at: string
          updated_at: string
          total_count: number
        }[]
      }
      create_service_template: {
        Args: { template_name: string; template_description?: string; template_unit_price?: number }
        Returns: string
      }
      update_service_template: {
        Args: {
          target_id: string
          template_name: string
          template_description?: string
          template_unit_price?: number
          template_is_active?: boolean
        }
        Returns: undefined
      }
      delete_service_template: {
        Args: { target_id: string }
        Returns: undefined
      }
      get_order_service_lines: {
        Args: { target_order_id: string }
        Returns: Json
      }
      add_order_service_line: {
        Args: {
          target_order_id: string
          target_template_id: string
          line_quantity: number
          line_unit_price: number
        }
        Returns: string
      }
      set_order_service_line: {
        Args: { target_line_id: string; line_quantity: number; line_unit_price: number }
        Returns: undefined
      }
      remove_order_service_line: {
        Args: { target_line_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type ProfileRow = Database['public']['Tables']['profiles']['Row']
export type RoleRow = Database['public']['Tables']['roles']['Row']
export type PermissionRow = Database['public']['Tables']['permissions']['Row']
export type UserAccountRow = Database['public']['Views']['user_accounts']['Row']
export type AuditEventRow = Database['public']['Tables']['audit_events']['Row']
export type AuditEventInsert = Database['public']['Tables']['audit_events']['Insert']
export type ReferenceSetRow = Database['public']['Tables']['reference_sets']['Row']
export type ReferenceItemRow = Database['public']['Tables']['reference_items']['Row']
export type ReferenceSetSummaryRow = Database['public']['Views']['reference_set_summaries']['Row']
export type FieldEntitySummaryRow = Database['public']['Views']['field_entity_summaries']['Row']
export type DynamicFieldRow = Database['public']['Tables']['dynamic_fields']['Row']
export type DynamicFieldOptionRow = Database['public']['Tables']['dynamic_field_options']['Row']
export type CustomerRow = Database['public']['Tables']['customers']['Row']
export type DeviceRow = Database['public']['Tables']['devices']['Row']
export type DeviceListItemRow = Database['public']['Views']['device_list_items']['Row']
export type DeviceWarrantyRow = Database['public']['Tables']['device_warranties']['Row']
export type OrderRow = Database['public']['Tables']['orders']['Row']
export type OrderListItemRow = Database['public']['Views']['order_list_items']['Row']
export type OrderStatusCatalogRow = Database['public']['Views']['order_status_catalog']['Row']
export type OrderStatusGroupRow = Database['public']['Tables']['order_status_groups']['Row']
export type OrderStatusEventRow = Database['public']['Tables']['order_status_events']['Row']
export type OrderJournalEventRow = Database['public']['Tables']['order_journal_events']['Row']
export type OrderDiagnosticsItemRow = Database['public']['Views']['order_diagnostics_items']['Row']
export type OrderAttachmentRow = Database['public']['Tables']['order_attachments']['Row']
export type NotificationRow = Database['public']['Tables']['notifications']['Row']
export type NotificationRecipientRow = Database['public']['Tables']['notification_recipients']['Row']
export type TaskRow = Database['public']['Tables']['tasks']['Row']
