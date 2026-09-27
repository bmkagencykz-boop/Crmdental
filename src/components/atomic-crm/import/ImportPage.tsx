import { useTranslate } from "ra-core";

import { ImportWizard } from "./ImportWizard";

/** The import wizard as a page (button on the patients list) */
export const ImportPage = () => {
  const translate = useTranslate();
  return (
    <section className="glass flex max-w-5xl flex-col gap-6 rounded-lg p-7">
      <div>
        <h2 className="text-xl font-bold tracking-[-0.02em]">
          {translate("import.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {translate("import.hint")}
        </p>
      </div>
      <ImportWizard />
    </section>
  );
};

ImportPage.path = "/import";
