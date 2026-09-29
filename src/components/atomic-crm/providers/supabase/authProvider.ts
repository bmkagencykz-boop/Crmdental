import type { AuthProvider } from "ra-core";
import { supabaseAuthProvider } from "ra-supabase-core";

import type { MyAccessRights } from "../../access-rights/accessRights";
import { createRightsCache } from "../../access-rights/rightsCache";
import { canAccess } from "../commons/canAccess";
import { signedUrlOf } from "./attachmentUrls";
import { getSupabaseClient } from "./supabase";

// Access rights of the signed-in employee (stage 30, public.my_access_rights)
const myRights = createRightsCache(async () => {
  const { data, error } = await getSupabaseClient().rpc("my_access_rights");
  if (error) throw error;
  return (data ?? null) as MyAccessRights | null;
});

const getBaseAuthProvider = () =>
  supabaseAuthProvider(getSupabaseClient(), {
    getIdentity: async () => {
      const sale = await getSale();

      if (sale == null) {
        throw new Error();
      }

      return {
        id: sale.id,
        fullName: `${sale.first_name} ${sale.last_name}`,
        // The private bucket (stage 41): a signed link
        avatar: await signedUrlOf(sale.avatar?.src),
        // Integrator (stage 25): the banner shows the end of the access
        role: sale.role,
        access_expires_at: sale.access_expires_at ?? null,
      };
    },
  });

// To speed up checks, we cache the current sale in the local storage.
// It is cleared on logout.
const CURRENT_SALE_CACHE_KEY = "RaStore.auth.current_sale";

function getLocalStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

/**
 * Every visitor can register a new clinic, so the app is always "initialized"
 * (Atomic CRM used to redirect to the sign-up page until a first user existed).
 */
export async function getIsInitialized() {
  return true;
}

/**
 * Organization of the current user, used to store files under
 * "<organization_id>/" (see storage policies).
 */
export async function getCurrentOrganizationId(): Promise<number> {
  const sale = await getSale();
  if (sale?.organization_id == null) {
    throw new Error("No organization for the current user");
  }
  return sale.organization_id;
}

const getSale = async () => {
  const storage = getLocalStorage();
  const cachedValue = storage?.getItem(CURRENT_SALE_CACHE_KEY);
  if (cachedValue != null) {
    return JSON.parse(cachedValue);
  }

  const { data: dataSession, error: errorSession } =
    await getSupabaseClient().auth.getSession();

  // Shouldn't happen after login but just in case
  if (dataSession?.session?.user == null || errorSession) {
    return undefined;
  }

  const { data: dataSale, error: errorSale } = await getSupabaseClient()
    .from("sales")
    .select(
      "id, organization_id, first_name, last_name, avatar, role, access_expires_at",
    )
    .match({ user_id: dataSession?.session?.user.id })
    .single();

  // Shouldn't happen either as all users are sales but just in case
  if (dataSale == null || errorSale) {
    return undefined;
  }

  storage?.setItem(CURRENT_SALE_CACHE_KEY, JSON.stringify(dataSale));
  return dataSale;
};

function clearCache() {
  const storage = getLocalStorage();
  storage?.removeItem(CURRENT_SALE_CACHE_KEY);
  myRights.clear();
}

export const getAuthProvider = (): AuthProvider => {
  const baseAuthProvider = getBaseAuthProvider();
  return {
    ...baseAuthProvider,
    login: async (params) => {
      if (params.ssoDomain) {
        const { error } = await getSupabaseClient().auth.signInWithSSO({
          domain: params.ssoDomain,
        });
        if (error) {
          throw error;
        }
        return;
      }
      await baseAuthProvider.login(params);
      // A disabled account, or an integrator whose access expired (stage
      // 25), has no clinic: the database gives it no staff row
      clearCache();
      if ((await getSale()) == null) {
        await getSupabaseClient().auth.signOut();
        throw new Error("market.integrator.no_access");
      }
    },
    logout: async (params) => {
      clearCache();
      return baseAuthProvider.logout(params);
    },
    checkAuth: async (params) => {
      // Users are on the set-password page, nothing to do
      if (
        window.location.pathname === "/set-password" ||
        window.location.hash.includes("#/set-password")
      ) {
        return;
      }
      // Users are on the forgot-password page, nothing to do
      if (
        window.location.pathname === "/forgot-password" ||
        window.location.hash.includes("#/forgot-password")
      ) {
        return;
      }
      // Users are on the sign-up page, nothing to do
      if (
        window.location.pathname === "/sign-up" ||
        window.location.hash.includes("#/sign-up")
      ) {
        return;
      }

      return baseAuthProvider.checkAuth(params);
    },
    canAccess: async (params) => {
      // Get the current user
      const sale = await getSale();
      if (sale == null) return false;

      // The owner has every right; the others follow their matrix
      const rights =
        sale.role === "head" || sale.role === "manager"
          ? await myRights.get()
          : null;
      return canAccess(
        sale.role,
        params,
        rights?.rights,
        sale.id,
        rights?.branch_ids,
      );
    },
    getAuthorizationDetails(authorizationId: string) {
      return getSupabaseClient().auth.oauth.getAuthorizationDetails(
        authorizationId,
      );
    },
    approveAuthorization(authorizationId: string) {
      return getSupabaseClient().auth.oauth.approveAuthorization(
        authorizationId,
      );
    },
    denyAuthorization(authorizationId: string) {
      return getSupabaseClient().auth.oauth.denyAuthorization(authorizationId);
    },
  };
};
