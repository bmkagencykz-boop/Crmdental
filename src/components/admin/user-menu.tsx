import { Children, useCallback, useState } from "react";
import {
  Translate,
  useAuthProvider,
  useGetIdentity,
  useLogout,
  useTranslate,
  UserMenuContext,
} from "ra-core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export type UserMenuProps = {
  children?: React.ReactNode;
};

/**
 * A user menu component displayed in the top right corner of the admin layout.
 *
 * Provides access to user-related actions such as profile, settings, and logout.
 * Displays the user's avatar and name from the identity provider, and includes a logout option.
 * Only displays in applications using authentication.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/usermenu UserMenu documentation}
 */
export function UserMenu({ children }: UserMenuProps) {
  const authProvider = useAuthProvider();
  const { data: identity } = useGetIdentity();
  const logout = useLogout();
  const translate = useTranslate();

  const [open, setOpen] = useState(false);

  const handleToggleOpen = useCallback(() => {
    setOpen((prevOpen) => !prevOpen);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  if (!authProvider) return null;

  return (
    <UserMenuContext.Provider value={{ onClose: handleClose }}>
      <DropdownMenu open={open} onOpenChange={handleToggleOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-3 rounded-full py-1 pr-1 pl-3 text-right outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-foreground">
                {identity?.fullName}
              </span>
              {identity?.role ? (
                <span className="text-xs text-muted-foreground">
                  {translate(`crm.roles.${identity.role}`, { _: "" })}
                </span>
              ) : null}
            </span>
            <Avatar className="size-11">
              <AvatarImage src={identity?.avatar} role="presentation" />
              <AvatarFallback>{identity?.fullName?.charAt(0)}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-56"
          align="end"
          sideOffset={10}
          forceMount
        >
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">
                {identity?.fullName}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {children}
          {Children.count(children) > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => logout()} className="cursor-pointer">
            <Translate i18nKey="ra.auth.logout">Log out</Translate>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </UserMenuContext.Provider>
  );
}
