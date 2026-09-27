import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { NotificationPreferences } from "../types";

export const PREFERENCES_KEY = ["notification_preferences"];

/** What the current employee receives in the browser and in Telegram */
export const useNotificationPreferences = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: () => dataProvider.getNotificationPreferences(),
  });
};

export const useSaveNotificationPreferences = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const notify = useNotify();
  return useMutation({
    mutationFn: async (
      changes: Partial<
        Pick<
          NotificationPreferences,
          "kinds" | "browser_enabled" | "telegram_enabled"
        >
      >,
    ) => {
      const current =
        queryClient.getQueryData<NotificationPreferences>(PREFERENCES_KEY) ??
        (await dataProvider.getNotificationPreferences());
      return dataProvider.saveNotificationPreferences({
        kinds: changes.kinds ?? current.kinds,
        browser_enabled: changes.browser_enabled ?? current.browser_enabled,
        telegram_enabled: changes.telegram_enabled ?? current.telegram_enabled,
      });
    },
    onSuccess: (data) => queryClient.setQueryData(PREFERENCES_KEY, data),
    onError: () => notify("crm.settings.save_error", { type: "error" }),
  });
};
