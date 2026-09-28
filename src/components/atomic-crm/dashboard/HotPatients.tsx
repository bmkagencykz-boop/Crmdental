import { Plus } from "lucide-react";
import { useGetIdentity, useGetList, useTranslate } from "ra-core";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { SimpleList } from "../simple-list/SimpleList";
import { Avatar } from "../patients/Avatar";
import { patientDisplayName } from "../patients/parsePatientText";
import type { Patient } from "../types";

export const HotPatients = () => {
  const { identity } = useGetIdentity();
  const translate = useTranslate();
  const {
    data: patientData,
    total: patientTotal,
    isPending: patientsLoading,
  } = useGetList<Patient>(
    "patients",
    {
      pagination: { page: 1, perPage: 10 },
      sort: { field: "last_seen", order: "DESC" },
      filter: { status: "hot", sales_id: identity?.id },
    },
    { enabled: Number.isInteger(identity?.id) },
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <h2 className="text-[22px] font-normal tracking-[-0.02em] text-foreground">
          {translate("resources.patients.hot.title")}
        </h2>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-muted-foreground"
                asChild
              >
                <Link to="/patients/create">
                  <Plus className="w-4 h-4 text-primary" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate("resources.patients.action.create")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Card className="py-0">
        <SimpleList<Patient>
          linkType="show"
          data={patientData}
          total={patientTotal}
          isPending={patientsLoading}
          resource="patients"
          className="[&>li:first-child>a]:rounded-t-xl [&>li:last-child>a]:rounded-b-xl"
          primaryText={(patient) => patientDisplayName(patient)}
          secondaryText={(patient) => patient.phones?.[0] ?? patient.city}
          leftAvatar={(patient) => <Avatar record={patient} />}
          empty={
            <div className="p-4">
              <p className="text-sm mb-4">
                {translate("resources.patients.hot.empty_hint")}
              </p>
              <p className="text-sm">
                {translate("resources.patients.hot.empty_change_status")}
              </p>
            </div>
          }
        />
      </Card>
    </div>
  );
};
