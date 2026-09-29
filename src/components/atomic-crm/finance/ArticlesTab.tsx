import { useQueryClient } from "@tanstack/react-query";
import {
  useCreate,
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { StudioCard } from "../dashboard/StudioCards";
import { NativeSelect } from "../payments/PaymentDialog";
import type { CashExpenseCategory } from "../payments/types";
import type { CrmDataProvider } from "../providers/types";
import {
  FINANCE_METHODS,
  PNL_LINES,
  type ArticleActivity,
  type ArticleSection,
  type FinanceAccountKind,
  type FinanceArticle,
  type FinanceMethod,
  type PnlLine,
} from "./types";
import {
  FINANCE_KEY,
  useFinanceAccounts,
  useFinanceArticles,
  useMethodAccounts,
  useRefreshFinance,
} from "./useFinance";

const KINDS: FinanceAccountKind[] = ["cash", "bank", "kaspi", "other"];
const ACTIVITIES: ArticleActivity[] = ["operating", "investing", "financing"];

/**
 * «Статьи» (stage 44): the money accounts with their opening balance, the
 * account each method of the cash desk lands in, the articles of the ДДС
 * and the P&L (section, activity, line of the P&L), and the article of each
 * expense category of the cash desk. The owner and the head.
 */
export const ArticlesTab = () => (
  <div
    className="grid grid-cols-1 gap-5 xl:grid-cols-2"
    data-testid="finance-articles"
  >
    <AccountsCard />
    <MethodsCard />
    <ArticlesCard section="in" />
    <ArticlesCard section="out" />
    <CategoriesCard />
  </div>
);

const useSave = () => {
  const notify = useNotify();
  const refresh = useRefreshFinance();
  const [update] = useUpdate();
  const [create] = useCreate();
  const onError = (e: any) =>
    notify(e?.message || "ra.notification.http_error", { type: "error" });
  return {
    update: (
      resource: string,
      record: { id: Identifier },
      data: Record<string, unknown>,
    ) =>
      update(
        resource,
        { id: record.id, data, previousData: record },
        { onSuccess: refresh, onError },
      ),
    create: (
      resource: string,
      data: Record<string, unknown>,
      done?: () => void,
    ) =>
      create(
        resource,
        { data },
        {
          onSuccess: () => {
            refresh();
            done?.();
          },
          onError,
        },
      ),
  };
};

const ArchiveButton = ({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) => {
  const translate = useTranslate();
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 shrink-0 rounded-full px-3"
      onClick={onClick}
    >
      {translate(active ? "finance.setup.archive" : "finance.setup.restore")}
    </Button>
  );
};

const AccountsCard = () => {
  const translate = useTranslate();
  const { data: accounts = [] } = useFinanceAccounts();
  const save = useSave();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FinanceAccountKind>("bank");
  return (
    <StudioCard
      title={translate("finance.setup.accounts")}
      subtitle={translate("finance.setup.accounts_hint")}
    >
      <div className="flex flex-col gap-2" data-testid="finance-accounts">
        {accounts.map((account) => (
          <div
            key={account.id}
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-2xl bg-muted px-3 py-2",
              !account.is_active && "opacity-60",
            )}
          >
            <Input
              className="h-9 w-36"
              defaultValue={account.name}
              aria-label={translate("finance.setup.name")}
              onBlur={(event) =>
                event.target.value.trim() &&
                event.target.value !== account.name &&
                save.update("finance_accounts", account, {
                  name: event.target.value.trim(),
                })
              }
            />
            <NativeSelect
              value={account.kind}
              onChange={(value) =>
                save.update("finance_accounts", account, { kind: value })
              }
              aria-label={translate("finance.setup.kind")}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {translate(`finance.setup.kinds.${value}`)}
                </option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {translate("finance.setup.opening")}
              <Input
                className="h-9 w-32 text-right tabular-nums"
                inputMode="numeric"
                defaultValue={String(account.opening_balance ?? 0)}
                aria-label={translate("finance.setup.opening")}
                onBlur={(event) => {
                  const value = Math.round(
                    Number(
                      event.target.value
                        .replace(/[\s\u00a0₸]/g, "")
                        .replace(",", "."),
                    ),
                  );
                  if (
                    Number.isFinite(value) &&
                    value !== account.opening_balance
                  ) {
                    save.update("finance_accounts", account, {
                      opening_balance: value,
                    });
                  }
                }}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {translate("finance.setup.opening_date")}
              <Input
                type="date"
                className="h-9 w-40"
                defaultValue={account.opening_date ?? ""}
                aria-label={translate("finance.setup.opening_date")}
                onBlur={(event) =>
                  (event.target.value || null) !==
                    (account.opening_date ?? null) &&
                  save.update("finance_accounts", account, {
                    opening_date: event.target.value || null,
                  })
                }
              />
            </label>
            {!account.code ? (
              <ArchiveButton
                active={account.is_active}
                onClick={() =>
                  save.update("finance_accounts", account, {
                    is_active: !account.is_active,
                  })
                }
              />
            ) : null}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Input
            className="h-10 w-48"
            value={name}
            placeholder={translate("finance.setup.new_account")}
            onChange={(event) => setName(event.target.value)}
            aria-label={translate("finance.setup.new_account")}
          />
          <NativeSelect
            value={kind}
            onChange={(value) => setKind(value as FinanceAccountKind)}
            aria-label={translate("finance.setup.kind")}
          >
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {translate(`finance.setup.kinds.${value}`)}
              </option>
            ))}
          </NativeSelect>
          <Button
            className="h-10 px-5"
            disabled={!name.trim()}
            onClick={() =>
              save.create(
                "finance_accounts",
                { name: name.trim(), kind, position: accounts.length },
                () => setName(""),
              )
            }
          >
            {translate("finance.setup.add")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {translate("finance.setup.opening_hint")}
        </p>
      </div>
    </StudioCard>
  );
};

const MethodsCard = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: accounts = [] } = useFinanceAccounts();
  const { data: map = [] } = useMethodAccounts(true);
  const change = async (method: FinanceMethod, accountId: string) => {
    try {
      await dataProvider.setFinanceMethodAccount(method, accountId);
      queryClient.invalidateQueries({ queryKey: [FINANCE_KEY] });
    } catch (e: any) {
      notify(e?.message || "ra.notification.http_error", { type: "error" });
    }
  };
  return (
    <StudioCard
      title={translate("finance.setup.methods")}
      subtitle={translate("finance.setup.methods_hint")}
    >
      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        data-testid="finance-methods"
      >
        {FINANCE_METHODS.map((method) => (
          <label
            key={method}
            className="flex items-center justify-between gap-2 rounded-2xl bg-muted px-3 py-2 text-sm"
          >
            <span>{translate(`finance.setup.methods_list.${method}`)}</span>
            <NativeSelect
              value={String(
                map.find((row) => row.method === method)?.account_id ?? "",
              )}
              onChange={(value) => change(method, value)}
              aria-label={translate(`finance.setup.methods_list.${method}`)}
            >
              {accounts.map((account) => (
                <option key={account.id} value={String(account.id)}>
                  {account.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ))}
      </div>
    </StudioCard>
  );
};

const ArticlesCard = ({ section }: { section: ArticleSection }) => {
  const translate = useTranslate();
  const { data: all = [] } = useFinanceArticles();
  const articles = all.filter((a) => a.section === section);
  const save = useSave();
  const [name, setName] = useState("");
  const [activity, setActivity] = useState<ArticleActivity>("operating");
  const [line, setLine] = useState<PnlLine | "">(
    section === "out" ? "opex" : "",
  );
  const lineSelect = (
    value: string,
    onChange: (value: string) => void,
    disabled?: boolean,
  ) => (
    <NativeSelect
      value={value}
      onChange={onChange}
      aria-label={translate("finance.setup.pnl_line")}
    >
      <option value="">{translate("finance.setup.no_pnl")}</option>
      {PNL_LINES.map((key) => (
        <option key={key} value={key} disabled={disabled}>
          {translate(`finance.setup.pnl_lines.${key}`)}
        </option>
      ))}
    </NativeSelect>
  );
  return (
    <StudioCard
      title={translate(
        section === "in"
          ? "finance.setup.articles_in"
          : "finance.setup.articles_out",
      )}
      subtitle={translate("finance.setup.articles_hint")}
    >
      <div
        className="flex flex-col gap-2"
        data-testid={`finance-articles-${section}`}
      >
        {articles.map((article: FinanceArticle) => (
          <div
            key={article.id}
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-2xl bg-muted px-3 py-2",
              !article.is_active && "opacity-60",
            )}
          >
            <Input
              className="h-9 min-w-40 flex-1"
              defaultValue={article.name}
              aria-label={translate("finance.setup.name")}
              onBlur={(event) =>
                event.target.value.trim() &&
                event.target.value !== article.name &&
                save.update("finance_articles", article, {
                  name: event.target.value.trim(),
                })
              }
            />
            {article.code ? (
              <span className="rounded-full bg-card px-3 py-1 text-xs text-muted-foreground">
                {translate(`finance.activities.${article.activity}`)} ·{" "}
                {article.pnl_line
                  ? translate(`finance.setup.pnl_lines.${article.pnl_line}`)
                  : translate("finance.setup.no_pnl")}
              </span>
            ) : (
              <>
                <NativeSelect
                  value={article.activity}
                  onChange={(value) =>
                    save.update("finance_articles", article, {
                      activity: value,
                    })
                  }
                  aria-label={translate("finance.setup.activity")}
                >
                  {ACTIVITIES.map((value) => (
                    <option key={value} value={value}>
                      {translate(`finance.activities.${value}`)}
                    </option>
                  ))}
                </NativeSelect>
                {lineSelect(article.pnl_line ?? "", (value) =>
                  save.update("finance_articles", article, {
                    pnl_line: value || null,
                  }),
                )}
              </>
            )}
            <ArchiveButton
              active={article.is_active}
              onClick={() =>
                save.update("finance_articles", article, {
                  is_active: !article.is_active,
                })
              }
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Input
            className="h-10 w-48"
            value={name}
            placeholder={translate("finance.setup.new_article")}
            onChange={(event) => setName(event.target.value)}
            aria-label={translate("finance.setup.new_article")}
          />
          <NativeSelect
            value={activity}
            onChange={(value) => setActivity(value as ArticleActivity)}
            aria-label={translate("finance.setup.activity")}
          >
            {ACTIVITIES.map((value) => (
              <option key={value} value={value}>
                {translate(`finance.activities.${value}`)}
              </option>
            ))}
          </NativeSelect>
          {lineSelect(line, (value) => setLine(value as PnlLine | ""))}
          <Button
            className="h-10 px-5"
            disabled={!name.trim()}
            onClick={() =>
              save.create(
                "finance_articles",
                {
                  name: name.trim(),
                  section,
                  activity,
                  pnl_line: line || null,
                  position: 100 + articles.length,
                },
                () => setName(""),
              )
            }
          >
            {translate("finance.setup.add")}
          </Button>
        </div>
      </div>
    </StudioCard>
  );
};

const CategoriesCard = () => {
  const translate = useTranslate();
  const { data: articles = [] } = useFinanceArticles();
  const { data: categories = [] } = useGetList<
    CashExpenseCategory & { article_id?: Identifier | null }
  >("cash_expense_categories", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "position", order: "ASC" },
  });
  const save = useSave();
  const outs = articles.filter((a) => a.section === "out");
  return (
    <StudioCard
      title={translate("finance.setup.categories")}
      subtitle={translate("finance.setup.categories_hint")}
    >
      <div className="flex flex-col gap-2" data-testid="finance-categories">
        {categories.map((category) => (
          <label
            key={category.id}
            className="flex items-center justify-between gap-2 rounded-2xl bg-muted px-3 py-2 text-sm"
          >
            <span
              className={cn(!category.is_active && "text-muted-foreground")}
            >
              {category.name}
            </span>
            <NativeSelect
              value={String(category.article_id ?? "")}
              onChange={(value) =>
                save.update("cash_expense_categories", category, {
                  article_id: value || null,
                })
              }
              aria-label={category.name}
            >
              <option value="">
                {translate("finance.setup.default_article", {
                  name: outs.find((a) => a.code === "other_out")?.name ?? "",
                })}
              </option>
              {outs.map((article) => (
                <option key={article.id} value={String(article.id)}>
                  {article.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          {translate("finance.setup.categories_note")}
        </p>
      </div>
    </StudioCard>
  );
};
