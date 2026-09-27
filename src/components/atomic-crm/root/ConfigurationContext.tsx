import { useMemo } from "react";
import { useStore } from "ra-core";

import type { NoteStatus } from "../types";
import { defaultConfiguration } from "./defaultConfiguration";

export const CONFIGURATION_STORE_KEY = "app.configuration";

/**
 * UI settings of a clinic (stored in the configuration table). Business
 * dictionaries (pipelines, stages, services, sources, lost reasons) live in
 * their own tables, see ../dictionaries.
 */
export interface ConfigurationContextValue {
  currency: string;
  noteStatuses: NoteStatus[];
  title: string;
  darkModeLogo: string;
  lightModeLogo: string;
}

export const useConfigurationContext = () => {
  const [config] = useStore<ConfigurationContextValue>(
    CONFIGURATION_STORE_KEY,
    defaultConfiguration,
  );
  // Merge with defaults so that missing fields in stored config
  // fall back to default values (e.g. when new settings are added)
  return useMemo(() => ({ ...defaultConfiguration, ...config }), [config]);
};

export const useConfigurationUpdater = () => {
  const [, setConfig] = useStore<ConfigurationContextValue>(
    CONFIGURATION_STORE_KEY,
  );
  return setConfig;
};
