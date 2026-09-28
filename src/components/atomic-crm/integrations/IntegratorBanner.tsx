import { useGetIdentity, useTranslate } from "ra-core";

/**
 * The integrator (stage 25) always sees that the account is a technical
 * access, and until when; deals and patients are read-only for it.
 */
export const IntegratorBanner = () => {
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  if (identity?.role !== "integrator") return null;
  const expiresAt = identity.access_expires_at as string | null | undefined;
  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-primary/40 bg-card px-4 py-2 text-sm"
      role="status"
      data-testid="integrator-banner"
    >
      <span className="font-semibold">
        {expiresAt
          ? translate("market.integrator.banner", {
              date: new Date(expiresAt).toLocaleDateString("ru-RU"),
            })
          : translate("market.integrator.banner_unlimited")}
      </span>
      <span className="text-muted-foreground">
        {translate("market.integrator.banner_hint")}
      </span>
    </div>
  );
};
