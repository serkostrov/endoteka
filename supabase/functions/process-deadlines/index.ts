import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Scheduled job: invoke this function on a cron (for example daily).
// It calls process_order_deadline_notifications() with the service role,
// so auth.uid() is null and the job can run without a user session.
// Recipients come from notification_rules, not from this function.
// Email/Telegram sending is dispatch-notifications, not this function.

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authHeader = request.headers.get('Authorization') ?? ''

    if (!isCronAuthorized(authHeader, serviceRoleKey)) {
      return jsonResponse({ error: 'Недостаточно прав для проверки сроков.' }, 401)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const { data, error } = await adminClient.rpc('process_order_deadline_notifications')

    if (error) {
      return jsonResponse({ error: error.message }, 400)
    }

    return jsonResponse({ sent: data ?? 0 }, 200)
  } catch {
    return jsonResponse({ error: 'Не удалось проверить сроки заказов.' }, 500)
  }
})

function isCronAuthorized(authHeader: string, serviceRoleKey: string) {
  const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
  const expected = new Set<string>()
  if (cronSecret.length >= 16) {
    expected.add(`Bearer ${cronSecret}`)
  }
  if (serviceRoleKey.length >= 20) {
    expected.add(`Bearer ${serviceRoleKey}`)
  }
  return expected.size > 0 && expected.has(authHeader)
}

function jsonResponse(payload: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
