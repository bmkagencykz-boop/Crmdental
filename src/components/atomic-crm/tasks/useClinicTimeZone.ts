import { useGetOne } from "ra-core";

import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import { DEFAULT_TIME_ZONE } from "../providers/commons/automessages";
import type { Organization } from "../types";

/** Time zone of the clinic (organizations.timezone), Asia/Almaty by default */
export const useClinicTimeZone = () => {
  const { data: settings } = useOrganizationSettings();
  const organizationId = settings?.organization_id;
  const { data: organization } = useGetOne<Organization>(
    "organizations",
    { id: organizationId! },
    { enabled: organizationId != null, staleTime: 10 * 60 * 1000 },
  );
  return organization?.timezone || DEFAULT_TIME_ZONE;
};
