import type { CrmMessages } from "./englishCrmMessages";

// Plurals follow Polyglot's Russian rules: "one |||| few |||| many"
// (1 пациент, 2 пациента, 5 пациентов).
export const russianCrmMessages: CrmMessages = {
  resources: {
    companies: {
      name: "Компания |||| Компании",
      forcedCaseName: "Компания",
      fields: {
        name: "Название компании",
        website: "Сайт",
        linkedin_url: "LinkedIn",
        phone_number: "Телефон",
        created_at: "Создана",
        nb_contacts: "Количество контактов",
        revenue: "Выручка",
        sector: "Отрасль",
        size: "Размер",
        tax_identifier: "БИН/ИИН",
        address: "Адрес",
        city: "Город",
        zipcode: "Индекс",
        state_abbr: "Область",
        country: "Страна",
        description: "Описание",
        context_links: "Ссылки",
        sales_id: "Ответственный",
      },
      empty: {
        description: "Список компаний пока пуст.",
        title: "Компании не найдены",
      },
      import: {
        title: "Импорт компаний",
      },
      field_categories: {
        contact: "Контакты",
        additional_info: "Дополнительно",
        address: "Адрес",
        context: "Контекст",
      },
      action: {
        create: "Создать компанию",
        edit: "Редактировать компанию",
        new: "Новая компания",
        show: "Открыть компанию",
      },
      added_on: "Добавлена %{date}",
      followed_by: "Ответственный: %{name}",
      followed_by_you: "Ответственный: вы",
      no_contacts: "Нет контактов",
      nb_contacts:
        "%{smart_count} контакт |||| %{smart_count} контакта |||| %{smart_count} контактов",
      nb_deals:
        "%{smart_count} сделка |||| %{smart_count} сделки |||| %{smart_count} сделок",
      sizes: {
        one_employee: "1 сотрудник",
        two_to_nine_employees: "2–9 сотрудников",
        ten_to_forty_nine_employees: "10–49 сотрудников",
        fifty_to_two_hundred_forty_nine_employees: "50–249 сотрудников",
        two_hundred_fifty_or_more_employees: "250 и более сотрудников",
      },
      autocomplete: {
        create_error: "Не удалось создать компанию",
        create_item: "Создать «%{item}»",
        create_label: "Начните вводить, чтобы создать компанию",
      },
    },
    contacts: {
      name: "Пациент |||| Пациенты",
      forcedCaseName: "Пациент",
      field_categories: {
        background_info: "Дополнительно",
        identity: "Личные данные",
        misc: "Прочее",
        personal_info: "Контакты",
        position: "Должность",
      },
      fields: {
        first_name: "Имя",
        last_name: "Фамилия",
        last_seen: "Последняя активность",
        title: "Должность",
        company_id: "Компания",
        email_jsonb: "Email",
        email: "Email",
        phone_jsonb: "Телефоны",
        phone_number: "Телефон",
        linkedin_url: "LinkedIn",
        background: "Дополнительная информация",
        has_newsletter: "Подписан на рассылку",
        sales_id: "Ответственный",
      },
      action: {
        add: "Добавить пациента",
        add_first: "Добавьте первого пациента",
        create: "Создать пациента",
        edit: "Редактировать пациента",
        export_vcard: "Экспорт в vCard",
        new: "Новый пациент",
        show: "Открыть карточку",
      },
      background: {
        last_activity_on: "Последняя активность %{date}",
        added_on: "Добавлен %{date}",
        followed_by: "Ответственный: %{name}",
        followed_by_you: "Ответственный: вы",
        status_none: "Нет",
      },
      position_at: "%{title} в",
      position_at_company: "%{title} в %{company}",
      empty: {
        description: "Список пациентов пока пуст.",
        title: "Пациенты не найдены",
      },
      import: {
        title: "Импорт пациентов",
      },
      inputs: {
        genders: {
          male: "Мужской",
          female: "Женский",
          nonbinary: "Не указан",
        },
        personal_info_types: {
          work: "Рабочий",
          home: "Домашний",
          other: "Другой",
        },
      },
      list: {
        error_loading: "Не удалось загрузить пациентов",
      },
      bulk_tag: {
        action: "Тег",
        back: "К списку тегов",
        create_description:
          "Создайте новый тег и назначьте его выбранным пациентам.",
        description:
          "Выберите существующий тег или создайте новый для выбранных пациентов.",
        empty: "Тегов пока нет. Создайте тег, чтобы отметить пациентов.",
        error: "Не удалось назначить тег",
        noop: "У выбранных пациентов уже есть этот тег",
        success:
          "Тег назначен %{smart_count} пациенту |||| Тег назначен %{smart_count} пациентам |||| Тег назначен %{smart_count} пациентам",
        title: "Назначить тег пациентам",
      },
      merge: {
        action: "Объединить с другим пациентом",
        confirm: "Объединить",
        current_contact: "Текущий пациент (будет удалён)",
        description: "Объединить этого пациента с другим.",
        error: "Не удалось объединить пациентов",
        merging: "Объединение...",
        no_additional_data: "Нет данных для переноса",
        select_target: "Выберите пациента для объединения",
        success: "Пациенты объединены",
        target_contact: "Основной пациент (останется)",
        title: "Объединение пациентов",
        warning_description:
          "Все данные будут перенесены во вторую карточку. Действие нельзя отменить.",
        warning_title: "Внимание: необратимое действие",
        what_will_be_merged: "Что будет перенесено:",
      },
      filters: {
        before_last_month: "Раньше прошлого месяца",
        before_this_month: "Раньше этого месяца",
        before_this_week: "Раньше этой недели",
        managed_by_me: "Мои пациенты",
        search: "Поиск по имени, телефону...",
        this_week: "На этой неделе",
        today: "Сегодня",
        tags: "Теги",
        tasks: "Задачи",
      },
      hot: {
        empty_change_status:
          "Статус пациента меняется при добавлении заметки: нажмите «Показать параметры».",
        empty_hint: "Здесь появятся пациенты со статусом «горячий».",
        title: "Горячие пациенты",
      },
    },
    deals: {
      name: "Сделка |||| Сделки",
      fields: {
        name: "Название",
        description: "Описание",
        company_id: "Компания",
        contact_ids: "Пациенты",
        category: "Услуга",
        amount: "Сумма",
        expected_closing_date: "Ожидаемая дата закрытия",
        stage: "Стадия",
      },
      action: {
        back_to_deal: "Назад к сделке",
        create: "Создать сделку",
        new: "Новая сделка",
      },
      field_categories: {
        misc: "Прочее",
      },
      filters: {
        only_mine: "Только мои сделки",
      },
      archived: {
        action: "В архив",
        error: "Ошибка: сделка не перенесена в архив",
        list_title: "Архив сделок",
        success: "Сделка перенесена в архив",
        title: "Сделка в архиве",
        view: "Архив сделок",
      },
      inputs: {
        linked_to: "Связана с",
      },
      unarchived: {
        action: "Вернуть на доску",
        error: "Ошибка: сделка не возвращена из архива",
        success: "Сделка возвращена на доску",
      },
      updated: "Сделка обновлена",
      empty: {
        before_create: "перед созданием сделки.",
        description: "Сделок пока нет.",
        title: "Сделки не найдены",
      },
      import: {
        title: "Импорт сделок",
      },
      invalid_date: "Неверная дата",
    },
    notes: {
      name: "Заметка |||| Заметки",
      forcedCaseName: "Заметка",
      fields: {
        status: "Статус",
        date: "Дата",
        attachments: "Вложения",
        contact_id: "Пациент",
        deal_id: "Сделка",
      },
      action: {
        add: "Добавить заметку",
        add_first: "Добавьте первую заметку",
        delete: "Удалить заметку",
        edit: "Редактировать заметку",
        update: "Сохранить заметку",
        add_this: "Добавить заметку",
      },
      sheet: {
        create: "Новая заметка",
        create_for: "Новая заметка: %{name}",
        edit: "Редактирование заметки",
        edit_for: "Редактирование заметки: %{name}",
      },
      deleted: "Заметка удалена",
      empty: "Заметок пока нет",
      author_added: "%{name} добавил(а) заметку",
      you_added: "Вы добавили заметку",
      me: "Я",
      list: {
        error_loading: "Не удалось загрузить заметки",
      },
      note_for_contact: "Заметка: %{name}",
      stepper: {
        hint: "Откройте карточку пациента и добавьте заметку",
      },
      added: "Заметка добавлена",
      inputs: {
        add_note: "Добавить заметку",
        options_hint: "(вложения и дополнительные поля)",
        show_options: "Показать параметры",
      },
      actions: {
        attach_document: "Прикрепить файл",
      },
      validation: {
        note_or_attachment_required: "Добавьте текст или вложение",
      },
    },
    sales: {
      name: "Сотрудник |||| Сотрудники",
      fields: {
        first_name: "Имя",
        last_name: "Фамилия",
        email: "Email",
        secondary_email: "Дополнительный email",
        secondary_emails: "Дополнительные email",
        administrator: "Руководство",
        disabled: "Отключён",
        role: "Роль",
      },
      create: {
        error: "Не удалось пригласить сотрудника.",
        success:
          "Сотрудник приглашён. Он получит письмо со ссылкой для установки пароля.",
        title: "Пригласить сотрудника",
      },
      edit: {
        error: "Произошла ошибка. Попробуйте ещё раз.",
        record_not_found: "Запись не найдена",
        success: "Данные сотрудника обновлены",
        title: "Редактирование: %{name}",
      },
      action: {
        new: "Пригласить сотрудника",
      },
    },
    tasks: {
      name: "Задача |||| Задачи",
      forcedCaseName: "Задача",
      fields: {
        text: "Описание",
        due_date: "Срок",
        type: "Тип",
        contact_id: "Пациент",
        due_short: "до",
      },
      action: {
        add: "Добавить задачу",
        create: "Создать задачу",
        edit: "Редактировать задачу",
      },
      actions: {
        postpone_next_week: "Перенести на следующую неделю",
        postpone_tomorrow: "Перенести на завтра",
        title: "действия с задачей",
      },
      added: "Задача добавлена",
      deleted: "Задача удалена",
      dialog: {
        create: "Новая задача",
        create_for: "Новая задача: %{name}",
      },
      sheet: {
        edit: "Редактирование задачи",
        edit_for: "Редактирование задачи: %{name}",
      },
      empty: "Задач пока нет",
      empty_list_hint: "Здесь появятся задачи по вашим пациентам.",
      filters: {
        later: "Позже",
        overdue: "Просроченные",
        this_week: "На этой неделе",
        today: "Сегодня",
        tomorrow: "Завтра",
        with_pending: "С открытыми задачами",
      },
      regarding_contact: "(%{name})",
      updated: "Задача обновлена",
    },
    tags: {
      name: "Тег |||| Теги",
      action: {
        add: "Добавить тег",
        create: "Создать тег",
      },
      dialog: {
        color: "Цвет",
        create_title: "Новый тег",
        edit_title: "Редактирование тега",
        name_label: "Название тега",
        name_placeholder: "Введите название",
      },
    },
  },
  crm: {
    action: {
      reset_password: "Сбросить пароль",
    },
    auth: {
      first_name: "Имя",
      last_name: "Фамилия",
      confirm_password: "Повторите пароль",
      confirmation_required:
        "Мы отправили вам письмо. Перейдите по ссылке из него, чтобы подтвердить аккаунт.",
      recovery_email_sent:
        "Если вы зарегистрированы, на вашу почту придёт письмо для восстановления пароля.",
      sign_in_failed: "Не удалось войти.",
      sign_in_google_workspace: "Войти через Google Workspace",
      organization_name: "Название клиники",
      register_clinic: "Зарегистрировать клинику",
      signup: {
        already_registered: "Уже есть аккаунт? Войти",
        clinic_created: "Клиника зарегистрирована",
        create_account: "Зарегистрироваться",
        create_clinic:
          "Зарегистрируйте клинику. Вы станете её владельцем и сможете пригласить сотрудников.",
        creating: "Создание...",
      },
      welcome_title: "Добро пожаловать в Dental CRM",
    },
    common: {
      account_manager: "Ответственный",
      activity: "Активность",
      added: "добавлено",
      details: "Подробности",
      last_activity_with_date: "последняя активность %{date}",
      load_more: "Показать ещё",
      misc: "Прочее",
      past: "Прошедшие",
      read_more: "Читать далее",
      retry: "Повторить",
      show_less: "Свернуть",
      today: "Сегодня",
      yesterday: "Вчера",
      copied: "Скопировано!",
      copy: "Копировать",
      loading: "Загрузка...",
      me: "Я",
      task_count:
        "%{smart_count} задача |||| %{smart_count} задачи |||| %{smart_count} задач",
    },
    changelog: {
      title: "Изменения",
    },
    deals: {
      count:
        "%{smart_count} сделка |||| %{smart_count} сделки |||| %{smart_count} сделок",
      quick_add: "Быстрое добавление",
    },
    roles: {
      owner: "Владелец",
      head: "Руководитель",
      manager: "Администратор",
    },
    activity: {
      added_company: "%{name} добавил(а) компанию",
      you_added_company: "Вы добавили компанию",
      added_contact: "%{name} добавил(а)",
      you_added_contact: "Вы добавили",
      added_note: "%{name} добавил(а) заметку о",
      you_added_note: "Вы добавили заметку о",
      added_note_about_deal: "%{name} добавил(а) заметку к сделке",
      you_added_note_about_deal: "Вы добавили заметку к сделке",
      added_deal: "%{name} добавил(а) сделку",
      you_added_deal: "Вы добавили сделку",
      at_company: "в",
      to: "к",
      load_more: "Показать ещё",
    },
    dashboard: {
      deals_chart: "Ожидаемая выручка",
      deals_pipeline: "Воронка сделок",
      latest_activity: "Последняя активность",
      latest_activity_error: "Не удалось загрузить активность",
      latest_notes: "Мои последние заметки",
      latest_notes_added_ago: "добавлено %{timeAgo}",
      stepper: {
        install: "Установить Dental CRM",
        progress: "Выполнено %{step} из 3",
        whats_next: "Что дальше?",
      },
      upcoming_tasks: "Ближайшие задачи",
    },
    data_import: {
      button: "Импорт CSV",
      complete:
        "Импорт завершён. Загружено записей: %{importCount}, ошибок: %{errorCount}",
      csv_file: "CSV-файл",
      error:
        "Не удалось импортировать файл. Проверьте, что это корректный CSV-файл.",
      in_progress: "Идёт импорт…",
      progress:
        "Загружено %{importCount} из %{rowCount} записей, ошибок: %{errorCount}.",
      remaining_time: "Осталось примерно:",
      resource: "Данные",
      sample_download: "Скачать пример CSV",
      sample_hint: "Пример CSV-файла, который можно использовать как шаблон",
      start: "Начать импорт",
      stop: "Остановить импорт",
      stopped:
        "Импорт остановлен. Загружено записей: %{importCount}, ошибок: %{errorCount}",
      title: "Импорт данных",
    },
    header: {
      import_data: "Импорт из JSON",
    },
    image_editor: {
      change: "Изменить",
      drop_hint: "Перетащите файл сюда или нажмите, чтобы выбрать.",
      editable_content: "Редактируемое содержимое",
      title: "Загрузка изображения",
      update_image: "Обновить изображение",
    },
    import: {
      action: {
        download_error_report: "Скачать отчёт об ошибках",
        import: "Импортировать",
        import_another: "Импортировать другой файл",
      },
      error: {
        unable: "Не удалось импортировать файл.",
      },
      idle: {
        description_1:
          "Можно импортировать сотрудников, компании, пациентов, заметки и задачи.",
        description_2: "Данные должны быть в JSON-файле такого формата:",
      },
      status: {
        all_success: "Все записи успешно импортированы.",
        complete: "Импорт завершён.",
        failed: "Ошибка",
        imported: "Импортировано",
        in_progress: "Идёт импорт, не закрывайте страницу.",
        some_failed: "Часть записей не импортирована.",
        table_caption: "Статус импорта",
      },
      title: "Импорт из JSON",
    },
    settings: {
      about: "О программе",
      companies: {
        sectors: "Отрасли",
      },
      dark_mode_logo: "Логотип для тёмной темы",
      deals: {
        categories: "Услуги",
        currency: "Валюта",
        pipeline_help: "Выберите стадии, которые считаются сделками в работе.",
        pipeline_statuses: "Стадии в работе",
        stages: "Стадии",
      },
      light_mode_logo: "Логотип для светлой темы",
      notes: {
        statuses: "Статусы",
      },
      reset_defaults: "Сбросить по умолчанию",
      save_error: "Не удалось сохранить настройки",
      saved: "Настройки сохранены",
      saving: "Сохранение...",
      tasks: {
        types: "Типы",
      },
      preferences: "Предпочтения",
      title: "Настройки",
      app_title: "Название",
      sections: {
        branding: "Оформление",
      },
      validation: {
        duplicate: "Повторяются %{display_name}: %{items}",
        in_use:
          "Нельзя удалить %{display_name}, которые используются в сделках: %{items}",
        validating: "Проверка…",
        entities: {
          categories: "услуги",
          stages: "стадии",
        },
      },
    },
    theme: {
      dark: "Тёмная",
      label: "Тема",
      light: "Светлая",
      system: "Системная",
    },
    language: "Язык",
    navigation: {
      label: "Навигация",
      dashboard: "Рабочий стол",
    },
    profile: {
      add_secondary_email: "Добавить email",
      email_taken: "%{email} уже используется другим сотрудником",
      no_secondary_emails: "Нет",
      secondary_email_invalid: "%{email} — некорректный email",
      secondary_email_is_primary: "%{email} уже указан как основной",
      secondary_email_taken: "%{email} уже используется другим сотрудником",
      too_many_secondary_emails:
        "Можно добавить не более 10 дополнительных адресов",
      secondary_emails_help:
        "Другие адреса, с которых вы пишете. Оставьте поле пустым, чтобы удалить адрес.",
      password: {
        change: "Сменить пароль",
      },
      password_reset_sent: "Письмо для смены пароля отправлено на вашу почту",
      record_not_found: "Запись не найдена",
      title: "Профиль",
      updated: "Профиль обновлён",
      update_error: "Произошла ошибка. Попробуйте ещё раз",
    },
    validation: {
      invalid_url: "Введите корректный адрес",
      invalid_linkedin_url: "Адрес должен быть с linkedin.com",
    },
  },
};

export const raSupabaseRussianMessages = {
  "ra-supabase": {
    auth: {
      email: "Email",
      confirm_password: "Повторите пароль",
      sign_in_with: "Войти через %{provider}",
      forgot_password: "Забыли пароль?",
      reset_password: "Сбросить пароль",
      password_reset: "Проверьте почту: мы отправили письмо для смены пароля.",
      missing_tokens: "Отсутствуют токены доступа",
      back_to_login: "Вернуться ко входу",
    },
    reset_password: {
      forgot_password: "Забыли пароль?",
      forgot_password_details: "Введите email, и мы пришлём инструкции.",
    },
    set_password: {
      new_password: "Придумайте пароль",
    },
    validation: {
      password_mismatch: "Пароли не совпадают",
    },
  },
};
