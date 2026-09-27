/* eslint-disable react-refresh/only-export-components */
import { memoryStore, type AuthProvider } from "ra-core";
import { useEffect, useMemo, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import cloneDeep from "lodash/cloneDeep";
import { Notification } from "@/components/admin/notification";
import { createDataProvider } from "@/components/atomic-crm/providers/fakerest";
import { DEFAULT_USER } from "@/components/atomic-crm/providers/fakerest/authProvider";
import type { Db } from "@/components/atomic-crm/providers/fakerest/dataGenerator/types";
import { generateDictionaries } from "@/components/atomic-crm/providers/fakerest/dataGenerator/dictionaries";
import type { Patient, Deal, Sale } from "@/components/atomic-crm/types";
import { CRM } from "@/components/atomic-crm/root/CRM";
import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";

export const createTestAuthProvider = (): AuthProvider => ({
  canAccess: async () => true,
  checkAuth: async () => undefined,
  checkError: async () => undefined,
  getIdentity: async () => ({
    avatar: DEFAULT_USER.avatar.src,
    fullName: `${DEFAULT_USER.first_name} ${DEFAULT_USER.last_name}`,
    id: DEFAULT_USER.id,
  }),
  login: async () => undefined,
  logout: async () => undefined,
});

const baseSale: Sale = {
  organization_id: 1,
  role: "owner",
  administrator: true,
  avatar: DEFAULT_USER.avatar as Sale["avatar"],
  disabled: false,
  email: DEFAULT_USER.email,
  first_name: DEFAULT_USER.first_name,
  id: DEFAULT_USER.id,
  last_name: DEFAULT_USER.last_name,
  password: DEFAULT_USER.password,
  user_id: DEFAULT_USER.id.toString(),
};

// Provide a minimal FakeRest database shape (with the default pipeline and
// dictionaries) so tests can override only the records that matter.
export const createCrmDb = (overrides: Partial<Db> = {}): Db => {
  const db = {
    configuration: [{ config: {}, id: 1 }],
    patient_notes: [],
    patients: [],
    deal_notes: [],
    deal_payments: [],
    deal_events: [],
    deals: [],
    calls: [],
    sales: [baseSale],
    tags: [],
    tasks: [],
  } as unknown as Db;
  generateDictionaries(db);
  return { ...db, ...overrides };
};

export const buildSale = (overrides: Partial<Sale> = {}): Sale => ({
  ...baseSale,
  ...overrides,
});

// Build a valid patient record with sensible defaults to keep tests and stories terse.
export const buildPatient = (overrides: Partial<Patient> = {}): Patient => ({
  background: "",
  first_name: "Айгерим",
  first_seen: "2025-01-01T09:00:00.000Z",
  gender: "female",
  id: 1,
  last_name: "Сапарова",
  last_seen: "2025-01-02T10:00:00.000Z",
  phone_jsonb: [{ number: "+77011234567", type: "mobile" }],
  sales_id: 0,
  tags: [],
  ...overrides,
});

export const buildDeal = (overrides: Partial<Deal> = {}): Deal => ({
  archived_at: null,
  created_at: "2025-01-01T09:00:00.000Z",
  description: "",
  id: 1,
  index: 0,
  name: "Имплантация",
  paid_amount: 0,
  patient_id: 1,
  pipeline_id: 1,
  plan_amount: 450000,
  sales_id: 0,
  stage_id: 1,
  tags: [],
  updated_at: "2025-01-01T09:00:00.000Z",
  ...overrides,
});

export const StoryWrapper = ({
  authProvider: authProviderOverrides,
  children,
  data,
  dataProvider: dataProviderOverrides,
  initialEntries,
  silent = import.meta.env.MODE === "test",
}: {
  authProvider?: Partial<AuthProvider>;
  children: ReactNode;
  data?: Partial<Db>;
  dataProvider?: Partial<ReturnType<typeof createDataProvider>>;
  initialEntries?: string[];
  silent?: boolean;
}) => {
  const authProvider = useMemo(
    () => ({ ...createTestAuthProvider(), ...authProviderOverrides }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const dataProvider = useMemo(
    () => ({
      ...createDataProvider({ db: createCrmDb(cloneDeep(data)), silent }),
      ...dataProviderOverrides,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const store = useMemo(() => memoryStore(), []);

  useEffect(() => {
    // Clear localStorage on mount to prevent data pollution from previous story / test, since we persist react-query cache in localStorage.
    localStorage.clear();
  }, []);

  return (
    <MemoryRouter initialEntries={initialEntries}>
      <CRM
        authProvider={authProvider}
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
        dashboard={() => <>{children}</>}
        store={store}
        layout={({ children }) => (
          <>
            {children}
            <Notification />
          </>
        )}
      />
    </MemoryRouter>
  );
};
