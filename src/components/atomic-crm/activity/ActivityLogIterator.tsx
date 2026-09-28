import { Fragment } from "react";
import {
  useListContext,
  useInfinitePaginationContext,
  useTranslate,
} from "ra-core";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/admin/spinner";

import type { Activity } from "../types";
import { ActivityLogItem } from "./ActivityLogItem";

export function ActivityLogIterator() {
  const { data, isPending, error, refetch } = useListContext<Activity>();
  const { hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfinitePaginationContext();
  const translate = useTranslate();

  if (isPending) {
    return (
      <div className="mt-1">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="space-y-2 mt-1" key={index}>
            <div className="flex flex-row space-x-2 items-center">
              <Skeleton className="w-5 h-5 rounded-full" />
              <Skeleton className="w-full h-4" />
            </div>
            <Skeleton className="w-full h-12" />
            <Separator />
          </div>
        ))}
      </div>
    );
  }

  if (error && !data?.length) {
    return (
      <div className="p-4">
        <div className="text-center text-muted-foreground mb-4">
          {translate("crm.dashboard.latest_activity_error", {
            _: "Error loading latest activity",
          })}
        </div>
        <div className="text-center mt-2">
          <Button onClick={() => refetch()}>
            {translate("crm.common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data?.map((activity, index) => (
        <Fragment key={index}>
          <ActivityLogItem activity={activity} />
          {index < data.length - 1 && <Separator />}
        </Fragment>
      ))}

      {hasNextPage && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            fetchNextPage();
          }}
          className="flex w-full justify-center text-sm underline hover:no-underline"
        >
          {isFetchingNextPage ? (
            <Spinner />
          ) : (
            translate("crm.activity.load_more")
          )}
        </a>
      )}
    </div>
  );
}
