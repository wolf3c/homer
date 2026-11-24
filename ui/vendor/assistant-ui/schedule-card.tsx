// Locally adapted official ScheduleCard; pinned source and adaptations in README.md.
"use client";

import type { ComponentProps, ReactNode } from "react";
import { ClockIcon } from "lucide-react";
import { cn } from "../task-status/utils";
import { field, mono, paper } from "./surfaces";

export function ScheduleCard({
  name,
  cadence,
  nextRun,
  statusLabel,
  timeLabel,
  endAction,
  note,
  onDetails,
  detailLabel,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  | "children"
  | "name"
  | "cadence"
  | "nextRun"
  | "enabled"
  | "history"
  | "onToggle"
> & {
  name: string;
  cadence: string;
  nextRun: string;
  statusLabel?: string;
  timeLabel: string;
  endAction?: ReactNode;
  note?: string;
  onDetails?: () => void;
  detailLabel?: string;
}) {
  return (
    <div
      data-slot="schedule-card"
      className={cn(
        paper,
        "flex w-full flex-col gap-3 rounded-2xl p-4",
        className,
      )}

      {...props}
    >
      {onDetails && <button type="button" className="card-detail-trigger" aria-label={detailLabel} onClick={onDetails} />}
      <div className="schedule-heading">
        <span className="schedule-clock bg-foreground/[0.05] text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
          <ClockIcon className="size-3.5" aria-hidden />
        </span>
        <span className="schedule-title text-[13.5px] font-medium">{name}</span>
        {statusLabel && <span className="schedule-status" data-enabled={statusLabel === "已启用" ? "" : undefined}>{statusLabel}</span>}
        <span className={cn(mono, "schedule-cadence text-muted-foreground")}>{cadence}</span>
      </div>
      <div className="schedule-bottom">
        <div className={cn(field, "schedule-delivery rounded-xl px-3 py-2")}>
          <span className={cn(mono, "text-muted-foreground")}>{timeLabel}</span>
          <span className="text-foreground/80 text-[13px]">{nextRun}</span>
        </div>
        {endAction}
      </div>
      {note && <p className="schedule-note">{note}</p>}

    </div>
  );
}
