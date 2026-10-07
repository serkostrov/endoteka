import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

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

    const smtp = readSmtpConfig()
    if (!smtp) {
      return jsonResponse(
        {
          error:
            'Почта не настроена. Задайте секреты SMTP_HOST и SMTP_FROM (или SMTP_USER) для функции invite-user.',
        },
        400,
      )
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

    const email = (body.email ?? '').trim().toLowerCase()
    const fullName = (body.fullName ?? '').trim()
    const roleId = (body.roleId ?? '').trim()
    const redirectTo = safeInviteRedirect(body.redirectTo, supabaseUrl)

    const { data: invitationId, error: invitationError } = await userClient.rpc('create_invitation', {
      target_email: email,
      target_full_name: fullName,
      target_role_id: roleId,
    })

    if (invitationError) {
      return jsonResponse({ error: cleanRpcMessage(invitationError.message) }, 400)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        data: { full_name: fullName },
        redirectTo,
      },
    })

    if (linkError || !linkData?.properties?.action_link) {
      await userClient.rpc('fail_invitation', {
        target_invitation_id: invitationId,
        reason: 'invite_link_failed',
      })
      return jsonResponse({ error: inviteErrorMessage(linkError?.message) }, 400)
    }

    const publicSupabaseUrl = Deno.env.get('SUPABASE_PUBLIC_URL') || supabaseUrl
    const actionLink = publicActionLink(linkData.properties.action_link, publicSupabaseUrl)

    try {
      await sendInviteEmail({
        smtp,
        to: email,
        fullName,
        actionLink,
      })
    } catch (cause) {
      const createdUserId = linkData.user?.id
      if (createdUserId) {
        await adminClient.auth.admin.deleteUser(createdUserId)
      }
      await userClient.rpc('fail_invitation', {
        target_invitation_id: invitationId,
        reason: 'invite_email_failed',
      })
      return jsonResponse(
        {
          error: errorMessage(cause) || 'Не удалось отправить письмо приглашения. Проверьте SMTP.',
        },
        400,
      )
    }

    return jsonResponse({ id: invitationId }, 200)
  } catch (cause) {
    return jsonResponse(
      { error: errorMessage(cause) || 'Не удалось отправить приглашение.' },
      500,
    )
  }
})

type SmtpConfig = {
  host: string
  port: number
  user?: string
  password?: string
  secure: boolean
  fromEmail: string
}

function readSmtpConfig(): SmtpConfig | null {
  const host = Deno.env.get('SMTP_HOST')?.trim()
  const fromEmail = (Deno.env.get('SMTP_FROM') ?? Deno.env.get('SMTP_USER') ?? '').trim()
  if (!host || !fromEmail) {
    return null
  }

  const port = Number(Deno.env.get('SMTP_PORT') ?? '587')
  const user = Deno.env.get('SMTP_USER')?.trim()
  const password = Deno.env.get('SMTP_PASSWORD') ?? undefined

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    user: user || undefined,
    password,
    secure: Deno.env.get('SMTP_SECURE') === 'true',
    fromEmail,
  }
}

async function sendInviteEmail(input: {
  smtp: SmtpConfig
  to: string
  fullName: string
  actionLink: string
}) {
  const greeting = input.fullName ? `${input.fullName}, здравствуйте!` : 'Здравствуйте!'
  const client = new SMTPClient({
    connection: {
      hostname: input.smtp.host,
      port: input.smtp.port,
      tls: input.smtp.secure,
      auth:
        input.smtp.user && input.smtp.password
          ? { username: input.smtp.user, password: input.smtp.password }
          : undefined,
    },
  })

  try {
    await client.send({
      from: input.smtp.fromEmail,
      to: input.to,
      subject: 'Приглашение в Эндотека',
      content: [
        greeting,
        '',
        'Вас пригласили в Эндотека.',
        'Перейдите по ссылке, чтобы принять приглашение и задать пароль:',
        input.actionLink,
        '',
        'Если вы не ожидали это письмо, просто проигнорируйте его.',
      ].join('\n'),
    })
  } finally {
    try {
      await client.close()
    } catch {
      // ignore close errors
    }
  }
}

function publicActionLink(actionLink: string, supabaseUrl: string) {
  try {
    const link = new URL(actionLink)
    const pub = new URL(supabaseUrl)
    link.protocol = pub.protocol
    link.host = pub.host
    return link.toString()
  } catch {
    return actionLink
  }
}

function inviteErrorMessage(message: string | undefined) {
  const lowered = (message ?? '').toLowerCase()
  if (lowered.includes('already') || lowered.includes('registered') || lowered.includes('exists')) {
    return 'Пользователь с таким email уже зарегистрирован.'
  }
  if (message?.trim()) {
    return cleanRpcMessage(message)
  }
  return 'Не удалось создать ссылку приглашения.'
}

function cleanRpcMessage(message: string) {
  return message.replace(/^[A-Z0-9_]+:\s*/i, '').trim() || message
}

function errorMessage(cause: unknown) {
  if (cause instanceof Error && cause.message) {
    return cause.message.slice(0, 500)
  }
  return ''
}

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
