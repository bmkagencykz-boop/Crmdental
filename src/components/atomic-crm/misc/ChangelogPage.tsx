import { useTranslate } from "ra-core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "./Markdown";
import changelogContent from "../../../../CHANGELOG.md?raw";

export const ChangelogPage = () => {
  const translate = useTranslate();

  return (
    <div className="max-w-3xl mx-auto my-8">
      <Card>
        <CardHeader>
          <CardTitle>{translate("crm.changelog.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Markdown>{changelogContent}</Markdown>
        </CardContent>
      </Card>
    </div>
  );
};

ChangelogPage.path = "/changelog";
