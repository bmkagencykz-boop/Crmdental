import type { Db } from "./types";

/**
 * Setup wizard of the demo clinic (stage 24): put off with a few steps
 * done, so that the demo opens on the dashboard and its «Продолжить
 * настройку» card leads to the wizard.
 */
export const generateOnboarding = (db: Db) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.onboarding_progress = [
    {
      id: 1,
      organization_id: 1,
      steps: { pipeline: "done", channels: "done", import: "skipped" },
      postponed_at: weekAgo,
      dismissed_at: null,
      completed_at: null,
      updated_at: weekAgo,
    },
  ];
};
