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
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: allowed, error: checkError } = await adminClient.rpc('can_bootstrap_director')
    if (checkError) {
      return jsonResponse({ error: checkError.message }, 400)
    }
    if (allowed !== true) {
      return jsonResponse({ error: 'Руководитель уже есть. Войдите или дождитесь приглашения.' }, 409)
    }

    const body = (await request.json()) as {
      email?: string
      fullName?: string
      password?: string
    }

    const email = (body.email ?? '').trim().toLowerCase()
    const fullName = (body.fullName ?? '').trim()
    const password = body.password ?? ''

    if (!email || !email.includes('@')) {
      return jsonResponse({ error: 'Укажите рабочий email.' }, 400)
    }
    if (fullName.length < 2) {
      return jsonResponse({ error: 'Укажите имя.' }, 400)
    }
    if (password.length < 8) {
      return jsonResponse({ error: 'Пароль должен содержать не меньше 8 символов.' }, 400)
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })

    if (createError || !created.user) {
      return jsonResponse(
        { error: createError?.message || 'Не удалось создать учётную запись.' },
        400,
      )
    }

    const { error: bootstrapError } = await adminClient.rpc('complete_director_bootstrap', {
      target_user_id: created.user.id,
      p_full_name: fullName,
    })

    if (bootstrapError) {
      await adminClient.auth.admin.deleteUser(created.user.id)
      return jsonResponse({ error: bootstrapError.message }, 400)
    }

    return jsonResponse({ ok: true }, 200)
  } catch {
    return jsonResponse({ error: 'Не удалось зарегистрировать руководителя.' }, 500)
  }
})

function jsonResponse(payload: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
