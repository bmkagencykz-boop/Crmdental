# Запуск в продакшне

Всё, что нужно, чтобы клиника работала на своём проекте Supabase. Отдельные этапы (`docs/stages/*.md`) описывают свои настройки подробнее; здесь — полный список в одном месте.

## 1. Проект и база

```bash
make supabase-remote-init   # создаёт проект, применяет миграции, задаёт ключи, выкладывает функции
```

Скрипт:

- создаёт проект Supabase и применяет все миграции (`supabase db push`);
- **не** загружает `supabase/seed.sql`: там демо-клиники с известным паролем, это только для локальной разработки;
- генерирует ключи фоновых задач и записывает их в секреты функций;
- пишет `supabase/.temp/vault-setup.sql` — **выполните его один раз в SQL-редакторе проекта и удалите файл**;
- пишет адрес и ключ проекта в `.env.production.local` для сборки интерфейса.

Если проект уже есть: `npx supabase link --project-ref <ref>`, затем `make supabase-deploy` (миграции + функции).

Расширения `pg_cron`, `pg_net`, `pg_trgm`, `btree_gist` и Vault включаются миграциями; на Supabase они доступны по умолчанию.

## 2. Секреты

### Vault (читает база, фоновые задачи)

| Имя | Значение | Кто использует |
|---|---|---|
| `project_url` | `https://<ref>.supabase.co` | все задачи pg_cron, которые вызывают функции |
| `automessages_dispatch_key` | случайная строка ≥ 32 символов | автосообщения, рассылки, исходящие вебхуки, синхронизация МИС |
| `notifications_dispatch_key` | случайная строка ≥ 32 символов | уведомления сотрудникам в Telegram |

Без них задачи не падают, а молча ничего не делают (в логе Postgres — предупреждение «Vault secrets … are not set»).

### Секреты функций (`npx supabase secrets set ИМЯ=значение`)

| Имя | Обязателен | Значение |
|---|---|---|
| `AUTOMESSAGES_DISPATCH_KEY` | да | тот же, что `automessages_dispatch_key` в Vault |
| `NOTIFICATIONS_DISPATCH_KEY` | да | тот же, что `notifications_dispatch_key` в Vault |
| `SB_PUBLISHABLE_KEY` | да | публичный ключ проекта (скрипт задаёт сам) |
| `WEBHOOK_BASE_URL` | да, если функции открыты не по `SUPABASE_URL/functions/v1` | публичный адрес функций — для вебхуков Wazzup24, Telegram, телефонии |
| `NOTIFY_TELEGRAM_BOT_TOKEN` | для уведомлений в Telegram | токен бота от BotFather |
| `NOTIFY_TELEGRAM_WEBHOOK_SECRET` | для уведомлений в Telegram | случайная строка; её же передать в `setWebhook` |
| `NOTIFY_APP_URL` | желательно | адрес CRM с `#`, например `https://crm.clinic.kz/#` — ссылки «Открыть сделку», «Открыть лабораторию» в Telegram |
| `VITE_ATTACHMENTS_BUCKET` | нет | корзина вложений заметок, по умолчанию `attachments` |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` Supabase подставляет сам.

Ключи клиник (Wazzup24, телефония, МИС, Telegram-бот клиники) вводятся в настройках CRM, не здесь.

## 3. Авторизация (Dashboard → Authentication)

`supabase/config.toml` описывает локальный стенд; в продакшне проверьте вручную:

- **Site URL** — адрес CRM; **Redirect URLs** — `https://<адрес CRM>/auth-callback.html`.
- **Confirm email — включить.** Локально выключено ради тестов.
- **SMTP** — свой почтовый сервер (встроенный Supabase отправляет несколько писем в час). Шаблоны писем приглашения и восстановления — в `supabase/templates/`, на русском.
- **Phone signups — выключить** (клиники регистрируются по почте).
- **Минимальная длина пароля — 8.**
- **OAuth server → Dynamic client registration** — оставьте включённым, только если подключаете внешних OAuth-клиентов (коннекторы маркетплейса); иначе выключите.

## 4. Интерфейс

```bash
npm run build          # переменные из .env.production.local
```

Переменные сборки: `VITE_SUPABASE_URL`, `VITE_SB_PUBLISHABLE_KEY` (обязательно); `VITE_WEBHOOK_BASE_URL` (если отличается от `…/functions/v1`); `VITE_NOTIFY_TELEGRAM_BOT` — username бота уведомлений (кнопка «Открыть бота» в профиле). Папка `dist` — статический сайт, подойдёт любой хостинг.

## 5. Внешние сервисы

- **Бот уведомлений** — вебхук на `https://<ref>.supabase.co/functions/v1/notify_telegram_webhook` с `secret_token` (см. `docs/stages/16-notifications.md`).
- **Wazzup24, Telegram-бот клиники, телефония, заявки с сайта, МИС** — подключаются из настроек CRM; адреса вебхуков CRM показывает там же.

## 6. Проверка после запуска

В SQL-редакторе:

```sql
-- задачи по расписанию на месте
select jobname, schedule, active from cron.job order by jobname;
-- последние запуски: ошибок быть не должно
select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;
-- ответы функций на вызовы из базы (коды 2xx)
select status_code, left(content, 120), created from net._http_response order by created desc limit 20;
-- секреты Vault заданы
select name from vault.decrypted_secrets where name in ('project_url', 'automessages_dispatch_key', 'notifications_dispatch_key');
```

Затем в CRM: зарегистрировать клинику, пригласить сотрудника (придёт письмо), привязать Telegram в профиле, создать сделку с задачей и дождаться уведомления о просрочке.

## 7. Резервные копии и данные

- Включите **Point-in-Time Recovery** или хотя бы ежедневные копии в тарифе Supabase: в базе медицинские и финансовые данные.
- Пациентов не удаляйте — архивируйте; платежи и медицинские записи защищены от каскадного удаления.
- Проверяйте восстановление из копии на отдельном проекте хотя бы раз в квартал.
