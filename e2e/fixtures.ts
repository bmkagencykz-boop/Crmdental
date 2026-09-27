import { test as base, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Test clinics and everything they own are removed by deleting the
// organizations: every tenant table cascades from them.
let testOrganizationId: number | null = null;

const requireTestOrganization = () => {
  if (testOrganizationId == null) {
    throw new Error("Call createSales before creating CRM records");
  }
  return testOrganizationId;
};

async function resetDb() {
  // Supabase client delete need a where clause to get executed, so we use one that will match on all rows (id is not null)
  await adminSupabase.from("organizations").delete().not("id", "is", null);

  // Delete all auth users (cascades to sales via DB trigger)
  const { data } = await adminSupabase.auth.admin.listUsers();
  await Promise.all(
    data.users.map((user) => adminSupabase.auth.admin.deleteUser(user.id)),
  );
  testOrganizationId = null;
}

async function createUser({
  email,
  password,
}: {
  email: string;
  password: string;
}) {
  const { data, error } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    throw new Error(`Failed to create user: ${error.message}`);
  }

  return data.user;
}

async function createSales({
  first_name,
  last_name,
  email,
  password,
  role,
}: {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  role?: "owner" | "head" | "manager";
}) {
  // The handle_new_user trigger creates the clinic for the first user (its
  // owner) and attaches the next ones to it (app_metadata is set by the
  // service role).
  const isFirstUser = testOrganizationId == null;
  const { data: userData, error: userError } =
    await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // Same metadata as the sign-up form and the users edge function
      user_metadata: isFirstUser
        ? { organization_name: "Test clinic", first_name, last_name }
        : { first_name, last_name },
      app_metadata: isFirstUser
        ? {}
        : { organization_id: testOrganizationId, role: role ?? "manager" },
    });

  if (userError) {
    throw new Error(`Failed to create sales: ${userError.message}`);
  }

  const { data, error } = await adminSupabase
    .from("sales")
    .update({
      first_name,
      last_name,
      role: role ?? (isFirstUser ? "owner" : "manager"),
    })
    .eq("user_id", userData.user?.id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create sales: ${error.message}`);
  }

  testOrganizationId ??= data.organization_id;

  return data;
}

async function createNotes({
  patientId,
  salesId,
  notes,
}: {
  patientId: string | number;
  salesId: string | number;
  notes: { text: string; date?: string }[];
}) {
  if (notes.length === 0) return;

  const { error } = await adminSupabase.from("patient_notes").insert(
    notes.map(({ text, date }) => ({
      organization_id: requireTestOrganization(),
      patient_id: patientId,
      sales_id: salesId,
      text,
      date,
      status: "cold",
    })),
  );

  if (error) {
    throw new Error(`Failed to create notes: ${error.message}`);
  }
}

async function createPatient({
  first_name,
  last_name,
  phone,
  sales_id,
  notes = [],
}: {
  first_name: string;
  last_name: string;
  phone?: string;
  sales_id: string | number;
  notes?: { text: string; date?: string }[];
}) {
  const { data, error } = await adminSupabase
    .from("patients")
    .insert({
      organization_id: requireTestOrganization(),
      first_name,
      last_name,
      sales_id,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      tags: [],
      background: "",
      phone_jsonb: phone ? [{ number: phone, type: "mobile" }] : [],
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create patient: ${error.message}`);
  }

  await createNotes({
    patientId: data.id,
    salesId: sales_id,
    notes,
  });

  return data;
}

/** Stages of the clinic's default pipeline, in board order */
async function getDefaultStages() {
  const { data: pipeline, error } = await adminSupabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", requireTestOrganization())
    .eq("is_default", true)
    .single();
  if (error) {
    throw new Error(`Failed to load the default pipeline: ${error.message}`);
  }
  const { data: stages, error: stagesError } = await adminSupabase
    .from("stages")
    .select("id, name, kind")
    .eq("pipeline_id", pipeline.id)
    .order("position");
  if (stagesError) {
    throw new Error(`Failed to load stages: ${stagesError.message}`);
  }
  return { pipelineId: pipeline.id as number, stages };
}

async function createDeal({
  patient_id,
  sales_id,
  name,
  stage,
  plan_amount = 0,
}: {
  patient_id: string | number;
  sales_id?: string | number | null;
  name: string;
  /** Stage name in the default pipeline; the first stage by default */
  stage?: string;
  plan_amount?: number;
}) {
  const { pipelineId, stages } = await getDefaultStages();
  const target = stage ? stages.find((s) => s.name === stage) : stages[0];
  if (!target) throw new Error(`Unknown stage ${stage}`);

  const { data, error } = await adminSupabase
    .from("deals")
    .insert({
      organization_id: requireTestOrganization(),
      patient_id,
      pipeline_id: pipelineId,
      stage_id: target.id,
      sales_id: sales_id ?? null,
      name,
      plan_amount,
      index: 0,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create deal: ${error.message}`);
  }
  return data;
}

/** Turns the clinic's task rules off (tests about deals without tasks) */
async function disableTaskRules() {
  const { error } = await adminSupabase
    .from("task_rules")
    .update({ is_active: false })
    .eq("organization_id", requireTestOrganization());
  if (error) throw new Error(`Failed to disable task rules: ${error.message}`);
}

/** What wazzup_connect stores: the clinic's key and webhook token */
async function connectMessenger() {
  const token = `test-token-${requireTestOrganization()}`;
  const { error } = await adminSupabase.from("messenger_integrations").upsert({
    organization_id: requireTestOrganization(),
    api_key: "test-key",
    webhook_token: token,
    connected_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to connect messenger: ${error.message}`);
  return token;
}

/** What wazzup_webhook does with a message from Wazzup24 */
async function receiveMessage(token: string, message: Record<string, unknown>) {
  const { data, error } = await adminSupabase.rpc("ingest_message", {
    webhook_token: token,
    message,
  });
  if (error) throw new Error(`Failed to ingest message: ${error.message}`);
  return data as { patient_id: number; deal_id: number };
}

/** The clinic's lead webhook token (what lead_webhook_token() creates) */
async function connectLeads() {
  const token = `lead-token-${requireTestOrganization()}`;
  const { error } = await adminSupabase.from("lead_integrations").upsert({
    organization_id: requireTestOrganization(),
    token,
  });
  if (error) throw new Error(`Failed to connect leads: ${error.message}`);
  return token;
}

/** What leads_webhook does with a website / Tilda / 2GIS form */
async function receiveLead(token: string, lead: Record<string, unknown>) {
  const { data, error } = await adminSupabase.rpc("ingest_lead", {
    token,
    lead,
  });
  if (error) throw new Error(`Failed to ingest lead: ${error.message}`);
  return data as { patient_id: number; deal_id: number; note_id: number };
}

/** What telegram_connect stores for the clinic's own Telegram bot */
async function connectTelegramBot(username = "smile_clinic_bot") {
  const organizationId = requireTestOrganization();
  const { data, error } = await adminSupabase
    .from("telegram_bots")
    .upsert({
      organization_id: organizationId,
      bot_token: "123456789:test-token",
      bot_id: 123456789,
      username,
      name: "Smile",
      connected_at: new Date().toISOString(),
    })
    .select("webhook_token, secret_token")
    .single();
  if (error) throw new Error(`Failed to connect the bot: ${error.message}`);
  return data as { webhook_token: string; secret_token: string };
}

const getMenuMethod = ({ page }: { page: Page; isMobile: boolean }) => ({
  goToDashboard: async () => {
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await page.waitForLoadState("networkidle");
  },
  goToPatients: async () => {
    await page.getByRole("link", { name: "Patients", exact: true }).click();
    await page.waitForLoadState("networkidle");
  },
  goToInbox: async () => {
    await page.getByRole("link", { name: /^Inbox/ }).click();
    await page.waitForLoadState("networkidle");
  },
  goToTasks: async () => {
    await page.getByRole("link", { name: "Tasks", exact: true }).click();
    await page.waitForLoadState("networkidle");
  },
  goToDeals: async () => {
    await page.getByRole("link", { name: "Deals", exact: true }).click();
    await page.waitForLoadState("networkidle");
  },
});

const login = async (page: Page, email: string, password = "password") => {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("link", { name: "Dashboard", exact: true }),
  ).toBeVisible();
};

/** Closes the modal (deal card, forms) that hides the rest of the page */
const closeDialog = async (page: Page) => {
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
};

const dismissToast = async (page: Page, content: string) => {
  await expect(page.getByText(content)).toBeVisible();
  await page.getByLabel("Close toast").first().click();
  // Since we are in optimistic UI, dismissing the toast trigger the request to the api linked to the toast message
  await page.waitForLoadState("networkidle");
};

export const test = base.extend<{
  resetDb: void;
  createUser: typeof createUser;
  createSales: typeof createSales;
  createPatient: typeof createPatient;
  createDeal: typeof createDeal;
  connectMessenger: typeof connectMessenger;
  disableTaskRules: typeof disableTaskRules;
  receiveMessage: typeof receiveMessage;
  connectLeads: typeof connectLeads;
  receiveLead: typeof receiveLead;
  connectTelegramBot: typeof connectTelegramBot;
  createNotes: typeof createNotes;
  menu: ReturnType<typeof getMenuMethod>;
  login: (email: string, password?: string) => Promise<void>;
  closeDialog: () => Promise<void>;
  dismissToast: (content: string) => Promise<void>;
}>({
  resetDb: [
    // The first argument to a Playwright fixture function must use object destructuring ({}) — _ is not allowed.
    // Playwright uses this to statically analyze which fixtures are requested.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await resetDb();
      await use();
    },
    { auto: true },
  ],
  // eslint-disable-next-line no-empty-pattern
  createUser: async ({}, cb) => {
    await cb(createUser);
  },
  // eslint-disable-next-line no-empty-pattern
  createSales: async ({}, cb) => {
    await cb(createSales);
  },
  // eslint-disable-next-line no-empty-pattern
  createPatient: async ({}, cb) => {
    await cb(createPatient);
  },
  // eslint-disable-next-line no-empty-pattern
  disableTaskRules: async ({}, cb) => {
    await cb(disableTaskRules);
  },
  // eslint-disable-next-line no-empty-pattern
  connectMessenger: async ({}, cb) => {
    await cb(connectMessenger);
  },
  // eslint-disable-next-line no-empty-pattern
  receiveMessage: async ({}, cb) => {
    await cb(receiveMessage);
  },
  // eslint-disable-next-line no-empty-pattern
  connectLeads: async ({}, cb) => {
    await cb(connectLeads);
  },
  // eslint-disable-next-line no-empty-pattern
  receiveLead: async ({}, cb) => {
    await cb(receiveLead);
  },
  // eslint-disable-next-line no-empty-pattern
  connectTelegramBot: async ({}, cb) => {
    await cb(connectTelegramBot);
  },
  // eslint-disable-next-line no-empty-pattern
  createDeal: async ({}, cb) => {
    await cb(createDeal);
  },
  // eslint-disable-next-line no-empty-pattern
  createNotes: async ({}, cb) => {
    await cb(createNotes);
  },
  menu: async ({ page, isMobile }, cb) => {
    await cb(getMenuMethod({ page, isMobile }));
  },
  login: async ({ page }, cb) => {
    await cb((email: string, password?: string) =>
      login(page, email, password),
    );
  },
  closeDialog: async ({ page }, cb) => {
    await cb(() => closeDialog(page));
  },
  dismissToast: async ({ page }, cb) => {
    await cb((content: string) => dismissToast(page, content));
  },
});

export { expect };
