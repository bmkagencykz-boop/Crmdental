export const englishCrmMessages = {
  resources: {
    patients: {
      name: "Patient |||| Patients",
      forcedCaseName: "Patient",
      fields: {
        first_name: "First name",
        last_name: "Last name",
        last_seen: "Last activity",
        phone_jsonb: "Phone numbers",
        phone_number: "Phone number",
        background: "Comment",
        sales_id: "Responsible",
        full_name: "Patient",
        middle_name: "Middle name",
        phone_fts: "Phone",
        whatsapp: "WhatsApp",
        instagram: "Instagram",
        telegram: "Telegram",
        birth_date: "Birth date",
        city: "City",
        source_id: "Source",
        deals: "Requests",
        nb_open_deals: "Requests",
        first_seen: "First contact",
        gender: "Gender",
        tags: "Tags",
      },
      action: {
        add: "Add patient",
        add_first: "Add your first patient",
        create: "Create patient",
        edit: "Edit patient",
        new: "New Patient",
        show: "Show patient",
      },
      background: {
        status_none: "None",
      },
      empty: {
        description: "Patients appear here with their first request.",
        title: "No patients found",
      },
      list: {
        error_loading: "Error loading patients",
      },
      bulk_tag: {
        action: "Tag",
        back: "Back to tags",
        create_description:
          "Create a new tag and apply it to the selected patients.",
        description:
          "Choose an existing tag or create a new one for the selected patients.",
        empty: "No tags yet. Create one to tag the selected patients.",
        error: "Failed to add tag to patients",
        noop: "Selected patients already have this tag",
        success:
          "Tag added to %{smart_count} patient |||| Tag added to %{smart_count} patients",
        title: "Add tag to patients",
      },
      filters: {
        managed_by_me: "My patients",
        search: "Name or phone",
        tags: "Tags",
      },
      hot: {
        empty_change_status:
          'Change the status of a patient by adding a note to that patient and clicking on "show options".',
        empty_hint: 'Patients with a "hot" status will appear here.',
        title: "Hot Patients",
      },
    },
    deals: {
      name: "Deal |||| Deals",
      action: {
        back_to_deal: "Back to deal",
        create: "Create deal",
        new: "New Deal",
        edit: "Edit deal",
      },
      filters: {
        only_mine: "Only deals I manage",
      },
      archived: {
        action: "Archive",
        error: "Error: deal not archived",
        list_title: "Archived Deals",
        success: "Deal archived",
        title: "Archived Deal",
        view: "View archived deals",
      },
      unarchived: {
        action: "Send back to the board",
        error: "Error: deal not unarchived",
        success: "Deal unarchived",
      },
      updated: "Deal updated",
      empty: {
        description: "Deals appear here with every new request.",
        title: "No deals found",
      },
      forcedCaseName: "Deal",
      fields: {
        name: "Title",
        description: "Comment",
        patient_id: "Patient",
        pipeline_id: "Pipeline",
        stage_id: "Stage",
        source_id: "Source",
        service_id: "Service",
        plan_amount: "Treatment plan",
        paid_amount: "Paid",
        sales_id: "Responsible",
        lost_reason_id: "Lost reason",
        lost_comment: "Lost comment",
        appointment_at: "Appointment",
        visit_at: "Visit",
        created_at: "Created",
        tags: "Tags",
        archived_at: "Archive",
      },
    },
    notes: {
      name: "Note |||| Notes",
      forcedCaseName: "Note",
      fields: {
        status: "Status",
        date: "Date",
        attachments: "Attachments",
        patient_id: "Patient",
        deal_id: "Deal",
      },
      action: {
        add: "Add note",
        add_first: "Add your first note",
        delete: "Delete note",
        edit: "Edit note",
        update: "Update note",
        add_this: "Add this note",
      },
      sheet: {
        create: "Create note",
        create_for: "Create note for %{name}",
        edit: "Edit note",
        edit_for: "Edit note for %{name}",
      },
      deleted: "Note deleted",
      empty: "No notes yet",
      author_added: "%{name} added a note",
      you_added: "You added a note",
      me: "Me",
      list: {
        error_loading: "Error loading notes",
      },
      added: "Note added",
      inputs: {
        add_note: "Add a note",
        options_hint: "(attach files, or change details)",
        show_options: "Show options",
      },
      actions: {
        attach_document: "Attach document",
      },
      validation: {
        note_or_attachment_required: "A note or an attachment is required",
      },
    },
    sales: {
      name: "User |||| Users",
      fields: {
        first_name: "First name",
        last_name: "Last name",
        email: "Email",
        secondary_email: "Secondary email",
        secondary_emails: "Secondary emails",
        administrator: "Admin",
        disabled: "Disabled",
        role: "Role",
      },
      create: {
        error: "An error occurred while creating the user.",
        success:
          "User created. They will soon receive an email to set their password.",
        title: "Create a new user",
      },
      edit: {
        error: "An error occurred. Please try again.",
        record_not_found: "Record not found",
        success: "User updated successfully",
        title: "Edit %{name}",
      },
      action: {
        new: "New user",
      },
    },
    tasks: {
      name: "Task |||| Tasks",
      forcedCaseName: "Task",
      fields: {
        text: "Description",
        due_date: "Due date",
        type: "Type",
        due_short: "due",
        deal_id: "Deal",
      },
      action: {
        add: "Add task",
        create: "Create task",
        edit: "Edit task",
      },
      actions: {
        postpone_next_week: "Postpone to next week",
        postpone_tomorrow: "Postpone to tomorrow",
        title: "task actions",
      },
      added: "Task added",
      deleted: "Task deleted successfully",
      dialog: {
        create: "Create task",
        create_for: "Create task for %{name}",
      },
      sheet: {
        edit: "Edit task",
        edit_for: "Edit task for %{name}",
      },
      empty: "No tasks yet",
      empty_list_hint: "Tasks added to your patients will appear here.",
      filters: {
        later: "Later",
        overdue: "Overdue",
        this_week: "This week",
        today: "Today",
        tomorrow: "Tomorrow",
        with_pending: "With pending tasks",
      },
      updated: "Task updated",
    },
    tags: {
      name: "Tag |||| Tags",
      action: {
        add: "Add tag",
        create: "Create new tag",
      },
      dialog: {
        color: "Color",
        create_title: "Create a new tag",
        edit_title: "Edit tag",
        name_label: "Tag name",
        name_placeholder: "Enter tag name",
      },
    },
  },
  crm: {
    action: {
      reset_password: "Reset Password",
    },
    auth: {
      first_name: "First name",
      last_name: "Last name",
      confirm_password: "Confirm password",
      confirmation_required:
        "Please follow the link we just sent you by email to confirm your account.",
      recovery_email_sent:
        "If you're a registered user, you should receive a password recovery email shortly.",
      sign_in_failed: "Failed to log in.",
      sign_in_google_workspace: "Sign in with Google Workplace",
      organization_name: "Clinic name",
      register_clinic: "Register a new clinic",
      signup: {
        already_registered: "Already have an account? Sign in",
        clinic_created: "Your clinic has been created",
        create_account: "Create account",
        create_clinic:
          "Register your clinic. You will be its owner and will be able to invite your team.",
        creating: "Creating...",
      },
      welcome_title: "Welcome to Dental CRM",
    },
    common: {
      account_manager: "Responsible",
      activity: "Activity",
      added: "added",
      details: "Details",
      last_activity_with_date: "last activity %{date}",
      load_more: "Load more",
      misc: "Misc",
      past: "Past",
      read_more: "Read more",
      retry: "Retry",
      show_less: "Show less",
      today: "Today",
      yesterday: "Yesterday",
      copied: "Copied!",
      copy: "Copy",
      loading: "Loading...",
      me: "Me",
      task_count: "%{smart_count} task |||| %{smart_count} tasks",
    },
    changelog: {
      title: "Changelog",
    },
    deals: {
      count: "%{smart_count} deal |||| %{smart_count} deals",
      quick_add: "Quick add",
      untitled: "Untitled",
      unassigned: "Unassigned",
      no_task: "No task",
      overdue_task: "Overdue",
      moved_to_first_stage:
        "A deal moved to another pipeline starts at its first stage.",
      no_task_hint:
        "No open task. Plan the next step so the patient isn't lost.",
      search: "Name or phone",
      name_placeholder: "e.g. Implants, upper jaw",
      sections: {
        request: "Request",
        pipeline: "Pipeline",
        details: "Details",
        payments: "Payments",
        history: "History",
      },
      lost: {
        title: "Why did the patient refuse?",
        description: "A lost reason is required to close the deal.",
        comment: "Comment",
        confirm: "Close as lost",
      },
      payments: {
        rest: "Balance",
        amount: "Amount, ₸",
        date: "Date",
        comment: "Comment",
        add: "Add payment",
        added: "Payment added",
      },
      events: {
        system: "system",
        created: "Deal created at stage «%{stage}»",
        stage_changed: "Stage:",
      },
    },
    roles: {
      owner: "Owner",
      head: "Head",
      manager: "Manager",
    },
    dashboard: {
      latest_activity: "Latest Activity",
      latest_activity_error: "Error loading latest activity",
      latest_notes: "My Latest Notes",
      latest_notes_added_ago: "added %{timeAgo}",
      upcoming_tasks: "Upcoming Tasks",
      summary: {
        pipeline: "In progress",
        open_deals: "Open deals",
        due_today: "Tasks today",
        overdue: "Overdue",
        paid: "Paid",
      },
    },
    image_editor: {
      change: "Change",
      drop_hint: "Drop a file to upload, or click to select it.",
      editable_content: "Editable content",
      title: "Upload and resize image",
      update_image: "Update Image",
    },
    settings: {
      about: "About",
      dark_mode_logo: "Dark Mode Logo",
      light_mode_logo: "Light Mode Logo",
      save_error: "Failed to save configuration",
      saved: "Configuration saved successfully",
      saving: "Saving...",
      title: "Settings",
      app_title: "App Title",
      sections: {
        pipelines: "Pipelines",
        services: "Services",
        sources: "Lead sources",
        lost_reasons: "Lost reasons",
        access: "Access",
        clinic: "Clinic",
      },
      hints: {
        pipelines:
          "Stages of each pipeline. Every pipeline needs a «won» and a «lost» stage.",
        services: "What patients come for. Used in deals and reports.",
        sources:
          "Where requests come from. System sources can't be deleted, only hidden.",
        lost_reasons: "Required when a deal is closed as lost.",
        access: "What managers see and how deals move between pipelines.",
        clinic: "Name and logo shown in the app.",
      },
      errors: {
        in_use: "It is still used by deals: move them first.",
      },
      move_up: "Move up",
      move_down: "Move down",
      name: "Name",
      active: "Active",
      system_item: "System item: it can be hidden but not deleted",
      new_item: "New item",
      add: "Add",
      pipelines: {
        name: "Pipeline name",
        new: "New pipeline",
        new_stage: "New stage",
        make_default: "Make default",
        delete: "Delete pipeline",
        color: "Stage color",
        rules:
          "Stages with deals can't be deleted. A pipeline keeps at least one won and one lost stage.",
        kinds: {
          open: "In progress",
          won: "Won",
          lost: "Lost (refusal)",
        },
      },
      access: {
        visibility: "Deals visible to managers",
        visibility_all: "All deals of the clinic",
        visibility_own: "Only their own",
        visibility_own_and_unassigned: "Their own and unassigned",
        pipeline_move: "Moving a deal to another pipeline",
        pipeline_move_first_stage: "Always to the first stage",
        pipeline_move_choose_stage: "Choose the stage",
      },
    },
    theme: {
      dark: "Dark",
      label: "Theme",
      light: "Light",
      system: "System",
    },
    language: "Language",
    navigation: {
      label: "CRM navigation",
      dashboard: "Dashboard",
    },
    profile: {
      add_secondary_email: "Add an email",
      email_taken: "%{email} is already used by another user",
      no_secondary_emails: "None",
      secondary_email_invalid: "%{email} is not a valid email address",
      secondary_email_is_primary: "%{email} is already your main address",
      secondary_email_taken: "%{email} is already used by another user",
      too_many_secondary_emails:
        "You cannot add more than 10 secondary email addresses",
      secondary_emails_help:
        "Other addresses you send emails from. Leave one empty to remove it.",
      password: {
        change: "Change password",
      },
      password_reset_sent:
        "A reset password email has been sent to your email address",
      record_not_found: "Record not found",
      title: "Profile",
      updated: "Your profile has been updated",
      update_error: "An error occurred. Please try again",
    },
    patients: {
      found_by_phone: "A patient with this phone already exists: %{name}",
      create_error: "Could not create the patient",
      create_item: "Create «%{item}»",
      create_label: "Type a name and a phone to create a patient",
      sections: {
        identity: "Patient",
        contacts: "Contacts",
        clinic: "Clinic",
        notes: "Comment",
        requests: "Requests",
      },
      duplicate_phone: "This phone already belongs to:",
      deal_counts: "%{open} open of %{total}",
      new_request: "New request",
      no_requests: "No requests yet",
      paid: "paid %{amount}",
    },
    calls: {
      title: "Calls",
      add: "Log call",
      added: "Call logged",
      comment: "Comment",
      duration: "Duration, m:ss",
      direction: {
        in: "Incoming",
        out: "Outgoing",
      },
    },
    tasks: {
      types: {
        call: "Call",
        message: "Message",
        reminder: "Reminder",
        other: "Other",
      },
    },
    activity: {
      you: "You",
      added_patient: "added patient",
      you_added_patient: "added patient",
      opened_deal: "opened deal",
      you_opened_deal: "opened deal",
      added_patient_note: "added a note to the",
      you_added_patient_note: "added a note to the",
      added_deal_note: "added a note to the",
      you_added_deal_note: "added a note to the",
      patient: "patient card",
      deal: "deal",
      load_more: "Load more activity",
    },
  },
} as const;

type MessageSchema<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends Record<string, unknown>
      ? MessageSchema<T[K]>
      : never;
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown>
    ? DeepPartial<T[K]>
    : T[K];
};

export type CrmMessages = MessageSchema<typeof englishCrmMessages>;
export type PartialCrmMessages = DeepPartial<CrmMessages>;
