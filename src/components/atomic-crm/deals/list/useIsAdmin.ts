import { useCanAccess } from "ra-core";

/**
 * The owner or the head (who edit the clinic settings and the deals); not
 * the integrator of stage 25, who configures but only reads the deals
 */
export const useIsAdmin = () => {
  const { canAccess } = useCanAccess({
    resource: "configuration",
    action: "edit",
  });
  const { canAccess: canEditDeals } = useCanAccess({
    resource: "deals",
    action: "edit",
  });
  return canAccess === true && canEditDeals === true;
};
