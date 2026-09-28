import type { Identifier } from "ra-core";

import { getSupabaseClient } from "./supabase";

/**
 * «Салесбот» (stage 26): the custom methods of the data provider. Bots,
 * sessions and logs are plain resources (RLS); starting and stopping a bot
 * on a deal go through the database functions.
 */
export const getSalesbotMethods = () => ({
  /** «Запустить бота»: replaces the running bot of the deal */
  async startSalesbot(
    dealId: Identifier,
    botId: Identifier,
  ): Promise<Identifier | null> {
    const { data, error } = await getSupabaseClient().rpc("start_salesbot", {
      target_deal_id: dealId,
      target_bot_id: botId,
    });
    if (error) throw error;
    return (data as Identifier | null) ?? null;
  },
  /** «Остановить бота»: false when no bot was running */
  async stopSalesbot(dealId: Identifier): Promise<boolean> {
    const { data, error } = await getSupabaseClient().rpc("stop_salesbot", {
      target_deal_id: dealId,
    });
    if (error) throw error;
    return !!data;
  },
});
