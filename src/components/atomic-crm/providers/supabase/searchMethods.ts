import {
  emptySearchResult,
  type GlobalSearchResult,
} from "../../search/globalSearch";
import { getSupabaseClient } from "./supabase";

/**
 * Global search (stage 31): public.global_search, security invoker — row
 * level security decides what the user finds.
 */
export const getSearchMethods = () => ({
  async globalSearch(q: string, maxPerKind = 5): Promise<GlobalSearchResult> {
    const { data, error } = await getSupabaseClient().rpc("global_search", {
      q,
      max_per_kind: maxPerKind,
    });
    if (error) throw error;
    return { ...emptySearchResult(), ...(data as GlobalSearchResult) };
  },
});
