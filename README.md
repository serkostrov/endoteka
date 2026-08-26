# Эндотека

Внутренняя система управления сервисным центром по ремонту эндоскопов.

## Стек

React, TypeScript, Vite, Supabase, Tailwind CSS, shadcn/ui.

## Локальный запуск

1. Скопируйте `.env.example` в `.env`.
2. Задайте только `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. Ключ `service_role` во фронтенд не помещайте.
3. Примените SQL из `supabase/migrations` в порядке имён файлов.
4. В Supabase Auth отключите публичную регистрацию. Учётные записи создаются только приглашением.
5. Создайте первого пользователя в Auth и назначьте роль `director`:

```sql
update public.profiles set is_active = true where email = 'director@example.ru';
insert into public.user_roles (user_id, role_id)
select p.id, r.id
from public.profiles p
join public.roles r on r.code = 'director'
where p.email = 'director@example.ru';
```

6. Установите зависимости и запустите приложение:

```bash
npm install
npm run dev
```

Подробности безопасности: [SECURITY.md](./SECURITY.md). Решения по нагрузке: [PERFORMANCE.md](./PERFORMANCE.md).

## Поставка (production)

### Dokploy

Приложение — статический фронтенд. База и Auth остаются в Supabase.

1. В Dokploy создайте приложение из Git, **Build Type: Dockerfile**.
2. Dockerfile path: `Dockerfile`, context: `.`, порт контейнера: `80`.
3. В Environment задайте:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Переменные читаются при старте контейнера, пересборка образа не нужна. `service_role` сюда не кладите.

4. Привяжите домен и HTTPS. Этот origin укажите в Edge Function `invite-user` как `SITE_URL`.
5. В Supabase Auth добавьте тот же origin в Redirect URLs (`https://ваш-домен/auth/callback`).

Проверка образа локально:

```bash
docker compose up --build
```

Healthcheck: `GET /health`.

### Клиент

Сборка: `npm run build`. В окружении фронтенда допустимы только `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.

### База

Миграции — каталог `supabase/migrations`, строго по имени файла. Писать данные напрямую в таблицы с клиента нельзя: изменения идут через RPC.

### Edge Functions

Опубликуйте все четыре функции. В среде функции уже есть `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`; их нельзя копировать в `.env` клиента.

| Функция | Назначение | Секреты |
| --- | --- | --- |
| `invite-user` | Приглашение сотрудника | `SITE_URL` |
| `process-deadlines` | Сроки заказов → внутренние уведомления | `CRON_SECRET` |
| `dispatch-notifications` | Повтор обработки событий, email и Telegram | `CRON_SECRET`, `SMTP_*`, `TELEGRAM_BOT_TOKEN` |
| `telegram-webhook` | Привязка чата `/start КОД` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` |

`SITE_URL` — origin приложения (редирект из письма приглашения). `CRON_SECRET` и `TELEGRAM_WEBHOOK_SECRET` — не короче 16 символов.

Пример SMTP:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
- `SMTP_SECURE` — `true` для TLS
- `SMTP_FROM` — адрес отправителя, если не задан в настройках уведомлений

Письмо приглашения идёт через SMTP **Supabase Auth**, не через `dispatch-notifications`.

### Cron

Внешнее расписание (Dashboard, pg_cron или иной планировщик). Заголовок: `Authorization: Bearer <CRON_SECRET>` (или service role ≥ 20 символов).

Рекомендуемые интервалы:

- `process-deadlines` — раз в сутки (или чаще в рабочее время)
- `dispatch-notifications` — каждые 1–5 минут

Ручная проверка сроков доступна руководителю в настройках заказов («Проверить сроки»), если есть право `settings:update`.

### Telegram

1. Создайте бота и задайте `TELEGRAM_BOT_TOKEN`.
2. Укажите webhook на `telegram-webhook` и секрет в заголовке `x-telegram-bot-api-secret-token`.
3. В настройках уведомлений включите канал Telegram.
4. Сотрудник связывает чат кодом из карточки в колокольчике.

### Импорт данных

CLI не входит в React-приложение. Нужны `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` в окружении скрипта:

```bash
npm run import -- preview --dir import/fixtures/full --phase full
npm run import -- import --dir import/fixtures/full --phase full --out ./import-out
```

Повторный запуск тех же файлов не создаёт дубликаты (`source_id` или естественный ключ). Форматы колонок — `import/src/catalog.ts`.

## Скрипты

- `npm run typecheck` — проверка типов
- `npm run lint` — ESLint
- `npm run build` — production-сборка
- `npm run format` — Prettier
- `npm run import` — импорт CSV

Никогда не помещайте `service_role` во фронтенд.
