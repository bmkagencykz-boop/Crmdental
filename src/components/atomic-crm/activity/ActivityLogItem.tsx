import { useGetIdentity, useTranslate } from "ra-core";
import { Link } from "react-router";

import {
  DEAL_CREATED,
  DEAL_NOTE_CREATED,
  PATIENT_CREATED,
  PATIENT_NOTE_CREATED,
} from "../consts";
import { RelativeDate } from "../misc/RelativeDate";
import { patientDisplayName } from "../patients/parsePatientText";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Activity } from "../types";
import { ActivityLogNote } from "./ActivityLogNote";

/**
 * One line of the activity feed: "<author> added <patient>", "<author>
 * opened a deal for <patient>", "<author> added a note about <patient>".
 */
export const ActivityLogItem = ({ activity }: { activity: Activity }) => {
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  const salesName = useGetSalesName(activity.sales_id ?? undefined, {
    enabled: activity.sales_id != null,
  });
  const isMe = activity.sales_id != null && activity.sales_id === identity?.id;
  const actor = isMe ? translate("crm.activity.you") : salesName || "—";
  const patientLink = (label: string) => (
    <Link to={`/patients/${activity.patient_id}/show`}>{label}</Link>
  );

  const header = (key: string, subject: React.ReactNode) => (
    <span className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{actor}</span>{" "}
      {translate(`crm.activity.${isMe ? "you_" : ""}${key}`)} {subject} ·{" "}
      <RelativeDate date={activity.date} />
    </span>
  );

  switch (activity.type) {
    case PATIENT_CREATED:
      return header(
        "added_patient",
        patientLink(patientDisplayName(activity.patient)),
      );
    case DEAL_CREATED:
      return header(
        "opened_deal",
        <Link to={`/deals/${activity.deal.id}/show`}>
          {activity.deal.name || translate("crm.deals.untitled")}
        </Link>,
      );
    case PATIENT_NOTE_CREATED:
      return (
        <ActivityLogNote
          header={header(
            "added_patient_note",
            patientLink(translate("crm.activity.patient")),
          )}
          text={activity.patientNote.text}
          link={`/patients/${activity.patient_id}/show`}
        />
      );
    case DEAL_NOTE_CREATED:
      return (
        <ActivityLogNote
          header={header(
            "added_deal_note",
            <Link to={`/deals/${activity.dealNote.deal_id}/show`}>
              {translate("crm.activity.deal")}
            </Link>,
          )}
          text={activity.dealNote.text}
          link={`/deals/${activity.dealNote.deal_id}/show`}
        />
      );
    default:
      return null;
  }
};
