import { mergeTranslations } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import russianMessages from "ra-language-russian";
import { raSupabaseEnglishMessages } from "ra-supabase-language-english";
import { englishCrmMessages } from "./englishCrmMessages";
import {
  raSupabaseRussianMessages,
  russianCrmMessages,
} from "./russianCrmMessages";

const raSupabaseEnglishMessagesOverride = {
  "ra-supabase": {
    auth: {
      password_reset: "Check your emails for a Reset Password message.",
    },
  },
};

const englishCatalog = mergeTranslations(
  englishMessages,
  raSupabaseEnglishMessages,
  raSupabaseEnglishMessagesOverride,
  englishCrmMessages,
);

// English stays underneath as a fallback for keys missing in Russian
const russianCatalog = mergeTranslations(
  englishCatalog,
  russianMessages,
  raSupabaseRussianMessages,
  russianCrmMessages,
);

// The product targets clinics in Kazakhstan: Russian is the default language.
export const getInitialLocale = (): "ru" | "en" => {
  if (typeof navigator === "undefined") {
    return "ru";
  }

  const browserLocale = navigator.languages?.[0] ?? navigator.language;
  if (browserLocale?.toLowerCase().startsWith("en")) {
    return "en";
  }

  return "ru";
};

export const i18nProvider = polyglotI18nProvider(
  (locale) => {
    if (locale === "en") {
      return englishCatalog;
    }
    return russianCatalog;
  },
  getInitialLocale(),
  [
    { locale: "ru", name: "Русский" },
    { locale: "en", name: "English" },
  ],
  { allowMissing: true },
);

export const testI18nProvider = polyglotI18nProvider(
  () => englishCatalog,
  "en",
  [{ locale: "en", name: "English" }],
  { allowMissing: true },
);
