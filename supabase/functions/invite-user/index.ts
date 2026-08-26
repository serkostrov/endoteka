import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authHeader = request.headers.get('Authorization')

    if (!authHeader) {
      return jsonResponse({ error: 'Требуется авторизация.' }, 401)
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: allowed, error: permissionError } = await userClient.rpc('has_permission', {
      permission_code: 'users:invite',
    })

    if (permissionError || allowed !== true) {
      return jsonResponse({ error: 'Недостаточно прав для приглашения сотрудников.' }, 403)
    }

    const body = (await request.json()) as {
      email?: string
      fullName?: string
      roleId?: string
      redirectTo?: string
    }

    const { data: invitationId, error: invitationError } = await userClient.rpc('create_invitation', {
      target_email: body.email ?? '',
      target_full_name: body.fullName ?? '',
      target_role_id: body.roleId ?? '',
    })

    if (invitationError) {
      return jsonResponse({ error: invitationError.message }, 400)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(body.email ?? '', {
      data: { full_name: body.fullName ?? '' },
      redirectTo: safeInviteRedirect(body.redirectTo, supabaseUrl),
    })

    if (inviteError) {
      await userClient.rpc('fail_invitation', {
        target_invitation_id: invitationId,
        reason: 'invite_email_failed',
      })
      return jsonResponse({ error: 'Не удалось отправить письмо. Проверьте email и настройки почты.' }, 400)
    }

    return jsonResponse({ id: invitationId }, 200)
  } catch {
    return jsonResponse({ error: 'Не удалось отправить приглашение.' }, 500)
  }
})

function allowedOrigins(supabaseUrl: string) {
  const origins = new Set<string>()
  for (const raw of [Deno.env.get('SITE_URL'), supabaseUrl, 'http://localhost:5173', 'http://127.0.0.1:5173']) {
    if (!raw) {
      continue
    }
    try {
      origins.add(new URL(raw).origin)
    } catch {
      // ignore malformed env
    }
  }
  return origins
}

function safeInviteRedirect(redirectTo: string | undefined, supabaseUrl: string) {
  if (!redirectTo) {
    const site = Deno.env.get('SITE_URL')
    if (!site) {
      return undefined
    }
    try {
      return `${new URL(site).origin}/auth/callback`
    } catch {
      return undefined
    }
  }

  try {
    const url = new URL(redirectTo)
    const isLocalHttp =
      url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    const isHttps = url.protocol === 'https:'

    if ((!isHttps && !isLocalHttp) || url.username || url.password || url.pathname !== '/auth/callback') {
      return undefined
    }

    if (!allowedOrigins(supabaseUrl).has(url.origin)) {
      return undefined
    }

    return `${url.origin}/auth/callback`
  } catch {
    return undefined
  }
}

function jsonResponse(payload: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
