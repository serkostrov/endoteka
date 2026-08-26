import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'

// Telegram bot webhook. Bot token stays in function secrets.
// User links an account by sending /start CODE from the app.

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: cors() })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: true }, 200)
  }

  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
  const provided = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (expectedSecret.length < 16 || provided !== expectedSecret) {
    return jsonResponse({ error: 'Недействительный запрос.' }, 401)
  }

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token) {
    return jsonResponse({ error: 'Токен бота не задан.' }, 500)
  }

  try {
    const update = (await request.json()) as TelegramUpdate
    const chatId = update.message?.chat?.id
    const text = update.message?.text ?? ''
    const username = update.message?.from?.username ?? ''

    if (chatId == null) {
      return jsonResponse({ ok: true }, 200)
    }

    const start = text.trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i)
    if (!start) {
      await reply(token, chatId, 'Чтобы привязать аккаунт, откройте Эндотеку, получите код и отправьте его командой /start КОД.')
      return jsonResponse({ ok: true }, 200)
    }

    const code = (start[1] ?? '').trim()
    if (!code) {
      await reply(token, chatId, 'Пришлите код из Эндотеки: /start КОД')
      return jsonResponse({ ok: true }, 200)
    }

    const adminClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data, error } = await adminClient.rpc('confirm_telegram_link', {
      p_code: code,
      p_chat_id: String(chatId),
      p_username: username,
    })

    if (error) {
      await reply(token, chatId, 'Не удалось привязать аккаунт. Попробуйте ещё раз.')
      return jsonResponse({ ok: true }, 200)
    }

    if (data === true) {
      await reply(token, chatId, 'Аккаунт привязан. Уведомления будут приходить сюда, если канал включён в правилах.')
    } else {
      await reply(token, chatId, 'Код не найден или истек. Получите новый код в Эндотеке.')
    }

    return jsonResponse({ ok: true }, 200)
  } catch {
    return jsonResponse({ ok: true }, 200)
  }
})

type TelegramUpdate = {
  message?: {
    text?: string
    chat?: { id?: number }
    from?: { username?: string }
  }
}

async function reply(token: string, chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token',
  }
}

function jsonResponse(payload: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json' },
  })
}
