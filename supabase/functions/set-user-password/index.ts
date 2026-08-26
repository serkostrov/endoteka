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
      permission_code: 'users:update',
    })

    if (permissionError || allowed !== true) {
      return jsonResponse({ error: 'Недостаточно прав для изменения пароля.' }, 403)
    }

    const body = (await request.json()) as { userId?: string; password?: string }
    const userId = body.userId?.trim() ?? ''
    const password = body.password ?? ''

    if (!userId) {
      return jsonResponse({ error: 'Не указан пользователь.' }, 400)
    }

    if (!password) {
      return jsonResponse({ id: userId }, 200)
    }

    if (password.length < 8) {
      return jsonResponse({ error: 'Пароль должен содержать не меньше 8 символов.' }, 400)
    }

    const { error: auditError } = await userClient.rpc('record_user_password_changed', {
      target_user_id: userId,
    })

    if (auditError) {
      return jsonResponse({ error: auditError.message }, 400)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, { password })

    if (updateError) {
      return jsonResponse({ error: 'Не удалось изменить пароль.' }, 400)
    }

    return jsonResponse({ id: userId }, 200)
  } catch {
    return jsonResponse({ error: 'Не удалось изменить пароль.' }, 500)
  }
})

function jsonResponse(payload: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
