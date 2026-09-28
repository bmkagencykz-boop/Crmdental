import { useMutation } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useDataProvider, useGetList, useNotify, useTranslate } from "ra-core";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { CrmDataProvider } from "../providers/types";
import { getSalesErrorNotification } from "../sales/salesErrorNotification";
import type { AssignableSaleRole, Sale } from "../types";
import { roleLabelKey } from "../sales/roleLabel";

const ROLES: AssignableSaleRole[] = ["manager", "head"];
const EMPTY = { first_name: "", last_name: "", email: "" };

/**
 * Step «Команда»: invite employees by email with a role, through the same
 * users edge function as Staff → New user (the owner only).
 */
export const TeamStep = ({ isOwner }: { isOwner: boolean }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [form, setForm] = useState(EMPTY);
  const [role, setRole] = useState<AssignableSaleRole>("manager");
  const { data: sales = [], refetch } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });
  const invite = useMutation({
    mutationFn: () =>
      dataProvider.salesCreate({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        role,
        disabled: false,
      }),
    onSuccess: () => {
      notify("onboarding.team.invited", {
        type: "info",
        messageArgs: { email: form.email.trim() },
      });
      setForm(EMPTY);
      refetch();
    },
    onError: (error: Error) => {
      const { message, args } = getSalesErrorNotification(
        error,
        error.message || translate("resources.sales.create.error"),
      );
      notify(message, { type: "error", messageArgs: args });
    },
  });
  const valid =
    form.first_name.trim() &&
    form.last_name.trim() &&
    /^\S+@\S+\.\S+$/.test(form.email.trim());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && !invite.isPending) invite.mutate();
  };
  const field = (name: keyof typeof EMPTY, type = "text") => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`onboarding-team-${name}`}>
        {translate(`onboarding.team.${name}`)}
      </Label>
      <Input
        id={`onboarding-team-${name}`}
        type={type}
        value={form[name]}
        onChange={(event) => setForm({ ...form, [name]: event.target.value })}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {isOwner ? (
        <form
          onSubmit={submit}
          className="grid max-w-3xl grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_12rem_auto]"
        >
          {field("first_name")}
          {field("last_name")}
          {field("email", "email")}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="onboarding-team-role">
              {translate("onboarding.team.role")}
            </Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as AssignableSaleRole)}
            >
              <SelectTrigger id="onboarding-team-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {translate(`crm.roles.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={!valid || invite.isPending}>
            <UserPlus className="size-4" />
            {translate("onboarding.team.invite")}
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">
            {translate("onboarding.team.email_hint")}
          </p>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("onboarding.team.owner_only")}
        </p>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {translate("onboarding.team.members")}
        </h3>
        <ul className="flex max-w-3xl flex-col divide-y rounded-md border bg-card">
          {sales.map((sale) => (
            <li
              key={sale.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="font-medium">
                {sale.first_name} {sale.last_name}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {sale.email}
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {translate(roleLabelKey(sale.role))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
