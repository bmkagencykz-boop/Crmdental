import { useMutation } from "@tanstack/react-query";
import {
  email,
  Form,
  useDataProvider,
  useGetIdentity,
  useGetOne,
  useLocaleState,
  useLocales,
  useNotify,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { useFormState } from "react-hook-form";
import { ArrayInput } from "@/components/admin/array-input";
import { RecordField } from "@/components/admin/record-field";
import { SimpleFormIterator } from "@/components/admin/simple-form-iterator";
import { TextInput } from "@/components/admin/text-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import ImageEditorField from "../misc/ImageEditorField";
import { NotificationPreferencesCard } from "../notifications/NotificationPreferencesCard";
import type { CrmDataProvider } from "../providers/types";
import { getSalesErrorNotification } from "../sales/salesErrorNotification";
import type { Sale, SalesFormData } from "../types";

export const ProfilePage = () => {
  const [isEditMode, setEditMode] = useState(false);
  const { identity, refetch: refetchIdentity } = useGetIdentity();
  const { data, refetch: refetchUser } = useGetOne("sales", {
    id: identity?.id,
  });
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { mutate } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SalesFormData) => {
      if (!identity) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.salesUpdate(identity.id, data);
    },
    onSuccess: () => {
      refetchIdentity();
      refetchUser();
      setEditMode(false);
      notify("crm.profile.updated", {
        messageArgs: {
          _: "Your profile has been updated",
        },
      });
    },
    onError: (error) => {
      refetchIdentity();
      refetchUser();
      const { message, args } = getSalesErrorNotification(error);
      notify(message, {
        type: "error",
        messageArgs: { ...args, _: "An error occurred. Please try again" },
      });
    },
  });

  if (!identity) return null;

  const handleOnSubmit = async (values: any) => {
    mutate(values);
  };

  return (
    <div className="max-w-lg mx-auto mt-8">
      <Form onSubmit={handleOnSubmit} record={data}>
        <ProfileForm isEditMode={isEditMode} setEditMode={setEditMode} />
      </Form>
      <div className="mt-4">
        <NotificationPreferencesCard />
      </div>
    </div>
  );
};

const ProfileForm = ({
  isEditMode,
  setEditMode,
}: {
  isEditMode: boolean;
  setEditMode: (value: boolean) => void;
}) => {
  const notify = useNotify();
  const translate = useTranslate();
  const record = useRecordContext<Sale>();
  const { identity, refetch } = useGetIdentity();
  const { isDirty } = useFormState();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { mutate: updatePassword } = useMutation({
    mutationKey: ["updatePassword"],
    mutationFn: async () => {
      if (!identity) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.updatePassword(identity.id);
    },
    onSuccess: () => {
      notify("crm.profile.password_reset_sent", {
        messageArgs: {
          _: "A reset password email has been sent to your email address",
        },
      });
    },
    onError: (e) => {
      notify(`${e}`, {
        type: "error",
      });
    },
  });

  const { mutate: mutateSale } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SalesFormData) => {
      if (!record) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.salesUpdate(record.id, data);
    },
    onSuccess: () => {
      refetch();
      notify("crm.profile.updated", {
        messageArgs: {
          _: "Your profile has been updated",
        },
      });
    },
    onError: () => {
      notify("crm.profile.update_error", {
        type: "error",
        messageArgs: {
          _: "An error occurred. Please try again.",
        },
      });
    },
  });
  if (!identity) return null;

  const handleClickOpenPasswordChange = () => {
    updatePassword();
  };

  const handleAvatarUpdate = async (values: any) => {
    mutateSale(values);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <div className="mb-4 flex flex-row justify-between">
            <h2 className="text-base font-semibold">
              {translate("crm.profile.title")}
            </h2>
          </div>

          <div className="space-y-4 mb-4">
            <ImageEditorField
              source="avatar"
              type="avatar"
              onSave={handleAvatarUpdate}
              linkPosition="right"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextRender source="first_name" isEditMode={isEditMode} />
              <TextRender source="last_name" isEditMode={isEditMode} />
            </div>
            <TextRender source="email" isEditMode={isEditMode} />
            <SecondaryEmailsRender isEditMode={isEditMode} />
            <LanguageSelector />
          </div>

          <div className="flex flex-row justify-end gap-2">
            {!isEditMode && (
              <>
                <Button
                  variant="outline"
                  type="button"
                  onClick={handleClickOpenPasswordChange}
                >
                  {translate("crm.profile.password.change")}
                </Button>
              </>
            )}

            <Button
              type="button"
              variant={isEditMode ? "ghost" : "outline"}
              onClick={() => setEditMode(!isEditMode)}
              className="flex items-center"
            >
              {isEditMode
                ? translate("ra.action.cancel")
                : translate("ra.action.edit")}
            </Button>

            {isEditMode && (
              <Button type="submit" disabled={!isDirty} variant="outline">
                {translate("ra.action.save")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const LanguageSelector = () => {
  const translate = useTranslate();
  const locales = useLocales();
  const [locale, setLocale] = useLocaleState();

  if (locales.length <= 1) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {translate("crm.language")}
      </p>
      <Select value={locale} onValueChange={setLocale}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {locales.map((language) => (
            <SelectItem key={language.locale} value={language.locale}>
              {language.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const TextRender = ({
  source,
  isEditMode,
  className,
}: {
  source: string;
  isEditMode: boolean;
  className?: string;
}) => {
  const label = `resources.sales.fields.${source}`;
  if (isEditMode) {
    return (
      <TextInput
        source={source}
        label={label}
        helperText={false}
        className={className}
      />
    );
  }
  return (
    <div className={className}>
      <RecordField source={source} label={label} />
    </div>
  );
};

const SecondaryEmailsRender = ({ isEditMode }: { isEditMode: boolean }) => {
  const translate = useTranslate();
  const label = "resources.sales.fields.secondary_emails";

  if (isEditMode) {
    return (
      <ArrayInput source="secondary_emails" label={label} helperText={false}>
        <SimpleFormIterator
          resource="sales"
          disableReordering
          fullWidth
          getItemLabel={false}
        >
          <TextInput
            source=""
            label={false}
            helperText={false}
            validate={email()}
            placeholder={translate("resources.sales.fields.email")}
          />
        </SimpleFormIterator>
      </ArrayInput>
    );
  }

  return (
    <RecordField
      source="secondary_emails"
      label={label}
      render={(record: Sale) => record.secondary_emails?.join(", ")}
      empty={translate("crm.profile.no_secondary_emails")}
    />
  );
};

ProfilePage.path = "/profile";
