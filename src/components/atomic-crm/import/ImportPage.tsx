import { useTranslate } from "ra-core";

import { ImportWizard } from "./ImportWizard";

/** The import wizard as a page (button on the patients list) */
export const ImportPage = () => {
  const translate = useTranslate();
  return (
    <section className="glass flex max-w-5xl flex-col gap-5 rounded-md p-5">
      <div>
        <h2 className="text-lg font-semibold">{translate("import.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {translate("import.hint")}
        </p>
      </div>
      <ImportWizard />
    </section>
  );
};

ImportPage.path = "/import";
