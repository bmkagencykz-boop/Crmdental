import type { ConfigurationContextValue } from "./ConfigurationContext";
// Import the logos as module assets so Vite resolves their URL relative to the
// JS chunk (import.meta.url), not the current route. A plain "./logos/..." path
// breaks on nested routes like /oauth/consent and under a deployment sub-path.
import darkModeLogo from "./logos/logo_atomic_crm_dark.svg";
import lightModeLogo from "./logos/logo_atomic_crm_light.svg";

export const defaultDarkModeLogo = darkModeLogo;
export const defaultLightModeLogo = lightModeLogo;

export const defaultCurrency = "KZT";

export const defaultTitle = "Dental CRM";

export const defaultNoteStatuses = [
  { value: "cold", label: "Холодный", color: "#7dbde8" },
  { value: "warm", label: "Тёплый", color: "#e8cb7d" },
  { value: "hot", label: "Горячий", color: "#e88b7d" },
  { value: "in-treatment", label: "На лечении", color: "#a4e87d" },
];

export const defaultConfiguration: ConfigurationContextValue = {
  currency: defaultCurrency,
  noteStatuses: defaultNoteStatuses,
  title: defaultTitle,
  darkModeLogo: defaultDarkModeLogo,
  lightModeLogo: defaultLightModeLogo,
};
