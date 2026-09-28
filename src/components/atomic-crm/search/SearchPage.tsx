import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useTranslate } from "ra-core";
import { Link, useSearchParams } from "react-router";

import { Input } from "@/components/ui/input";
import type { CrmDataProvider } from "../providers/types";
import {
  parseSearchQuery,
  SEARCH_KINDS,
  type GlobalSearchResult,
} from "./globalSearch";
import { addRecent } from "./recent";
import { useRecent } from "./GlobalSearch";
import { useSearchItems } from "./SearchResults";

const PAGE_LIMIT = 50;

/** «Показать все»: every kind of result, up to 50 each (/search?q=…) */
export const SearchPage = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const [recent, setRecent] = useRecent();
  useEffect(() => setDraft(q), [q]);

  const valid = parseSearchQuery(q) != null;
  const { data, isPending } = useQuery<GlobalSearchResult>({
    queryKey: ["globalSearch", q, PAGE_LIMIT],
    queryFn: () => dataProvider.globalSearch(q, PAGE_LIMIT),
    enabled: valid,
  });
  const items = useSearchItems(valid ? data : undefined, q);

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setParams({ q: draft.trim() });
        }}
      >
        <Input
          autoFocus
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={translate("search.placeholder")}
          aria-label={translate("search.aria")}
        />
      </form>
      {!valid ? (
        <p className="text-sm text-muted-foreground">
          {translate("search.page.empty")}
        </p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">
          {translate("search.searching")}
        </p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {translate("search.nothing")}
            </p>
          ) : null}
          {SEARCH_KINDS.map((kind) => {
            const rows = items.filter((item) => item.group === kind);
            if (rows.length === 0) return null;
            return (
              <section key={kind} className="flex flex-col">
                <h2 className="mb-1 text-sm font-semibold text-muted-foreground">
                  {translate(`search.groups.${kind}`)}{" "}
                  <span className="font-normal">
                    {rows.length >= PAGE_LIMIT ? `${PAGE_LIMIT}+` : rows.length}
                  </span>
                </h2>
                <div className="divide-y divide-border rounded-md border border-border bg-card">
                  {rows.map((item) => (
                    <Link
                      key={item.key}
                      to={item.to}
                      onClick={() => {
                        if (item.recent)
                          setRecent(addRecent(recent, item.recent));
                      }}
                      className="block px-3 py-2 no-underline hover:bg-accent"
                    >
                      {item.node}
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
          {items
            .filter((item) => item.group === "actions")
            .map((item) => (
              <Link key={item.key} to={item.to} className="no-underline">
                {item.node}
              </Link>
            ))}
        </>
      )}
    </div>
  );
};

SearchPage.path = "/search";
