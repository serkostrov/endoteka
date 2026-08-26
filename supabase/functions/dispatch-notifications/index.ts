import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Sends pending email/telegram deliveries. SMTP credentials and the bot token
// live in function secrets, not in client-readable database fields.
// Invoke on a short cron after business events; failures never touch orders.

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authHeader = request.headers.get('Authorization') ?? ''

    if (!isCronAuthorized(authHeader, serviceRoleKey)) {
      return jsonResponse({ error: 'Недостаточно прав для отправки уведомлений.' }, 401)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    await adminClient.rpc('process_pending_domain_events')

    const { data, error } = await adminClient.rpc('claim_notification_deliveries', { batch_size: 20 })
    if (error) {
      return jsonResponse({ error: error.message }, 400)
    }

    const rows = data ?? []
    let sent = 0
    let failed = 0

    for (const row of rows) {
      try {
        if (row.channel === 'email') {
          await sendEmail(row)
        } else if (row.channel === 'telegram') {
          await sendTelegram(row)
        } else {
          throw new Error('Неизвестный канал.')
        }
        await adminClient.rpc('record_notification_delivery', {
          target_id: row.id,
          p_status: 'sent',
          p_error: null,
        })
        sent += 1
      } catch (cause) {
        failed += 1
        await adminClient.rpc('record_notification_delivery', {
          target_id: row.id,
          p_status: 'failed',
          p_error: errorMessage(cause),
        })
      }
    }

    return jsonResponse({ claimed: rows.length, sent, failed }, 200)
  } catch (cause) {
    return jsonResponse({ error: errorMessage(cause) || 'Не удалось отправить уведомления.' }, 500)
  }
})

type DeliveryRow = {
  id: string
  channel: string
  title: string
  body: string
  email: string | null
  chat_id: string | null
  recipient_name: string
  from_name: string
  from_email: string
}

async function sendEmail(row: DeliveryRow) {
  const host = Deno.env.get('SMTP_HOST')
  const port = Number(Deno.env.get('SMTP_PORT') ?? '587')
  const user = Deno.env.get('SMTP_USER')
  const password = Deno.env.get('SMTP_PASSWORD')
  const secure = Deno.env.get('SMTP_SECURE') === 'true'
  const fromEmail = row.from_email || Deno.env.get('SMTP_FROM') || user || ''

  if (!host || !fromEmail) {
    throw new Error('SMTP не настроен. Задайте секреты SMTP_HOST и адрес отправителя.')
  }
  if (!row.email) {
    throw new Error('У сотрудника нет email.')
  }

  const client = new SMTPClient({
    connection: {
      hostname: host,
      port: Number.isFinite(port) ? port : 587,
      tls: secure,
      auth: user && password ? { username: user, password } : undefined,
    },
  })

  try {
    await client.send({
      from: row.from_name ? `${row.from_name} <${fromEmail}>` : fromEmail,
      to: row.email,
      subject: row.title,
      content: row.body,
    })
  } finally {
    try {
      await client.close()
    } catch {
      // ignore close errors
    }
  }
}

async function sendTelegram(row: DeliveryRow) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token) {
    throw new Error('Токен Telegram-бота не задан.')
  }
  if (!row.chat_id) {
    throw new Error('Сотрудник не привязал Telegram.')
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: row.chat_id,
      text: `${row.title}\n${row.body}`.trim(),
    }),
  })
  const payload = (await response.json()) as { ok?: boolean; description?: string }
  if (!payload.ok) {
    throw new Error(payload.description || 'Telegram не принял сообщение.')
  }
}

function errorMessage(cause: unknown) {
  if (cause instanceof Error && cause.message) {
    return cause.message.slice(0, 500)
  }
  return 'Ошибка доставки.'
}

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
