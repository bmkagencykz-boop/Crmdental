# Dental CRM

SaaS CRM продаж для стоматологических клиник: лиды, воронки, переписка, задачи, отчёты. Это не МИС и не расписание.

Построена на форке [Atomic CRM](https://github.com/marmelab/atomic-crm) (MIT): React, react-admin (shadcn-admin-kit), Supabase.

- ТЗ: [`docs/SPEC.md`](docs/SPEC.md)
- Согласованные решения по ТЗ: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Что сделано по этапам: [`docs/stages/`](docs/stages/)

## Запуск локально

Нужны Node 22, Make и Docker (для локального Supabase).

```sh
make install   # зависимости
make start     # Supabase + фронт на http://localhost:5173
```

`npx supabase db reset` применяет миграции и загружает демо-данные ([`supabase/seed.sql`](supabase/seed.sql)). Пароль у всех демо-аккаунтов — `demo1234`:

| Аккаунт | Клиника | Роль |
|---|---|---|
| owner@demo.kz | Демо-клиника «Жемчуг» | владелец |
| head@demo.kz | Демо-клиника «Жемчуг» | руководитель |
| admin@demo.kz | Демо-клиника «Жемчуг» | администратор |
| owner@other.kz | Демо-клиника «Улыбка» | владелец |

## Проверки

```sh
make typecheck
make lint
make test        # unit-тесты фронта и edge functions
make test-db     # миграции + тесты RLS на обычном Postgres (PGHOST, PGPORT, PGUSER)
```

`make test-db` не требует Docker. Скрипт [`scripts/db-test.sh`](scripts/db-test.sh):
1. поднимает чистую базу с заглушкой платформы Supabase;
2. применяет миграции и сид;
3. запускает SQL-тесты из [`supabase/tests/`](supabase/tests/);
4. проверяет, что декларативная схема (`supabase/schemas/`) даёт ту же базу, что и миграции.

## Структура базы

Источник правды — декларативная схема в `supabase/schemas/`. Каждое изменение схемы сопровождается миграцией в `supabase/migrations/`. Их совпадение проверяет `make test-db`.

## Лицензия

MIT. Основано на Atomic CRM © Marmelab, см. [`LICENSE.md`](LICENSE.md).
