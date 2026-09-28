import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import {
  ADDRESS_PLACEHOLDER,
  fillPlaceholder,
  formatTenge,
  isConsultation,
  PRICE_PLACEHOLDER,
} from "../../onboarding/servicePresets";
import type {
  ClinicProfile,
  OnboardingProgress,
  Organization,
  OrganizationSettings,
  QuickReply,
  Sale,
  Service,
} from "../../types";
import { normalizePhone } from "../commons/domain";

type ProgressPatch = Partial<
  Pick<
    OnboardingProgress,
    "steps" | "postponed_at" | "dismissed_at" | "completed_at"
  >
>;

const STATUSES = ["done", "skipped"];
const forbidden = () =>
  Object.assign(new Error("Only the owner and the head edit the clinic"), {
    code: "42501",
  });

/**
 * Setup wizard of the demo (stage 24): the same rules as
 * supabase/schemas/24_onboarding.sql — progress edited by the owner and the
 * head, the clinic profile, and the quick reply placeholders filled from the
 * address and the consultation price.
 */
export const createOnboardingDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
}) => {
  const canEdit = async () => {
    const salesId = await currentSalesId();
    const me = (await all<Sale>("sales")).find(
      (sale) => String(sale.id) === String(salesId),
    );
    // The demo user is the owner of the clinic
    return !me || me.role === "owner" || me.role === "head";
  };

  /** Same as private.fill_quick_reply_placeholder */
  const fillQuickReplies = async (placeholder: string, value: string) => {
    const replies = (await all<QuickReply>("quick_replies")).filter(
      (reply) => reply.sales_id == null && reply.text.includes(placeholder),
    );
    for (const reply of replies) {
      const text = fillPlaceholder(reply.text, placeholder, value);
      if (text === reply.text) continue;
      await baseDataProvider.update("quick_replies", {
        id: reply.id,
        data: { text },
        previousData: reply,
      });
    }
  };

  const progressRow = async () =>
    (
      await all<OnboardingProgress & { id: Identifier }>("onboarding_progress")
    )[0] ?? null;

  const methods = {
    getOnboardingProgress: async (): Promise<OnboardingProgress | null> =>
      progressRow(),
    updateOnboardingProgress: async (
      patch: ProgressPatch,
    ): Promise<OnboardingProgress> => {
      if (!(await canEdit())) throw forbidden();
      const row = await progressRow();
      if (!row) throw new Error("No onboarding progress");
      if (
        patch.steps &&
        Object.values(patch.steps).some(
          (status) => !STATUSES.includes(status as string),
        )
      ) {
        throw Object.assign(new Error("A step is done or skipped"), {
          code: "23514",
        });
      }
      const { data } = await baseDataProvider.update("onboarding_progress", {
        id: row.id,
        data: { ...patch, updated_at: new Date().toISOString() },
        previousData: row,
      });
      return data as OnboardingProgress;
    },
    saveClinicProfile: async (profile: ClinicProfile): Promise<void> => {
      if (!(await canEdit())) throw forbidden();
      const name = profile.name.trim();
      if (!name) {
        throw Object.assign(new Error("The clinic needs a name"), {
          code: "23514",
        });
      }
      const timezone = profile.timezone.trim() || "Asia/Almaty";
      const [organization] = await all<Organization>("organizations");
      if (organization) {
        await baseDataProvider.update("organizations", {
          id: organization.id,
          data: { name, timezone },
          previousData: organization,
        });
      }
      const { data: configuration } = await baseDataProvider.getOne(
        "configuration",
        { id: 1 },
      );
      if (configuration) {
        await baseDataProvider.update("configuration", {
          id: 1,
          data: { config: { ...(configuration.config ?? {}), title: name } },
          previousData: configuration,
        });
      }
      const [settings] = await all<OrganizationSettings & { id: Identifier }>(
        "organization_settings",
      );
      if (settings) {
        const phone = profile.phone.trim();
        await baseDataProvider.update("organization_settings", {
          id: settings.id,
          data: {
            clinic_city: profile.city.trim() || null,
            clinic_phone: phone ? (normalizePhone(phone) ?? phone) : null,
            clinic_address: profile.address.trim() || null,
          },
          previousData: settings,
        });
      }
      await fillQuickReplies(ADDRESS_PLACEHOLDER, profile.address);
    },
  };

  /** Same as private.handle_service_price */
  const onServiceSaved = async (service: Service) => {
    if (
      service.price != null &&
      !service.is_archived &&
      isConsultation(service.name)
    ) {
      await fillQuickReplies(PRICE_PLACEHOLDER, formatTenge(service.price));
    }
    return service;
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "services",
      afterCreate: async (result) => {
        await onServiceSaved(result.data as Service);
        return result;
      },
      afterUpdate: async (result) => {
        await onServiceSaved(result.data as Service);
        return result;
      },
    },
  ];

  return { methods, callbacks };
};
