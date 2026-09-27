import { useCanAccess } from "ra-core";

/** The owner or the head (who edit the clinic settings) */
export const useIsAdmin = () => {
  const { canAccess } = useCanAccess({
    resource: "configuration",
    action: "edit",
  });
  return canAccess === true;
};
