/**
 * Attachments are stored under "<organization_id>/<file>". Returns true when a
 * storage path belongs to the given organization's folder.
 */
export const isInOrganizationFolder = (
  path: string,
  organizationId: number,
): boolean => {
  const segments = path.split("/");
  return (
    segments.length > 1 &&
    segments[0] === String(organizationId) &&
    segments.every((segment) => segment !== "" && segment !== "..")
  );
};
