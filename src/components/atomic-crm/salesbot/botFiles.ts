import { useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, type Identifier } from "ra-core";

import { colors } from "../tags/colors";
import type { Tag } from "../types";
import {
  exportBot,
  importBot,
  missingTags,
  type BotDictionaries,
  type PortableBot,
} from "./portable";
import type { Salesbot } from "./types";

/**
 * Creates a bot of this clinic from portable JSON (a template of the
 * gallery or an imported file): the missing tags are created first, the
 * rest resolves by name. Returns the id of the new (inactive) bot.
 */
export const useCreateBotFromPortable = () => {
  const dataProvider = useDataProvider();
  const queryClient = useQueryClient();
  const notify = useNotify();
  return async (
    bot: PortableBot,
    dicts: BotDictionaries,
    position: number,
  ): Promise<Identifier> => {
    const created: { id: Identifier; name: string }[] = [];
    for (const [index, name] of missingTags(bot, dicts).entries()) {
      const { data } = await dataProvider.create<Tag>("tags", {
        data: { name, color: colors[index % colors.length] },
      });
      created.push({ id: data.id, name: data.name });
    }
    if (created.length) {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      notify("salesbot.gallery.tags_created", {
        type: "info",
        messageArgs: { names: created.map((t) => t.name).join(", ") },
      });
    }
    const { data } = await dataProvider.create<Salesbot>("salesbots", {
      data: {
        ...importBot(bot, { ...dicts, tags: [...dicts.tags, ...created] }),
        position,
      },
    });
    queryClient.invalidateQueries({ queryKey: ["salesbots"] });
    return data.id;
  };
};

/** Downloads the bot as portable JSON */
export const downloadBot = (bot: Salesbot, dicts: BotDictionaries) => {
  const json = JSON.stringify(exportBot(bot, dicts), null, 2);
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `salesbot-${bot.name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
