"use client";

import type { ComponentProps, ReactNode } from "react";
import { FileTextIcon, XIcon } from "lucide-react";
import { cn } from "../task-status/utils";
import { ghostButton } from "./surfaces";
import "./canvas-split.css";

export function CanvasSplitDocument({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="canvas-split-document"
      className={cn("flex min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  );
}

// Read-only files have no editor version/save state or document-copy action.
// The native dialog owner supplies only its existing close ID and focus ref.
export function CanvasSplitHeader({
  title,
  onClose,
  closeButtonProps,
  actions,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "title"> & {
  title: string;
  onClose?: () => void;
  closeButtonProps?: Omit<ComponentProps<"button">, "onClick" | "disabled">;
  actions?: ReactNode;
}) {
  return (
    <div
      data-slot="canvas-split-header"
      className={cn(
        "border-foreground/[0.07] flex items-center gap-2 border-b px-3.5 py-2.5",
        className,
      )}
      {...props}
    >
      <FileTextIcon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={title}>
        {title}
      </span>
      {actions}
      <button
        type="button"
        aria-label="关闭 Canvas"
        onClick={onClose}
        disabled={!onClose}
        className={cn(
          ghostButton,
          "size-7 shrink-0 disabled:pointer-events-none disabled:opacity-30",
        )}
        {...closeButtonProps}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

export function CanvasSplitBody({
  writing,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { writing?: boolean }) {
  return (
    <div
      data-slot="canvas-split-body"
      className={cn(
        "flex min-h-[9rem] flex-1 flex-col gap-1.5 overflow-y-auto p-4",
        className,
      )}
      {...props}
    >
      {children}
      {writing && (
        <span
          aria-hidden
          className="bg-foreground/70 h-[1.05em] w-[2px] animate-pulse rounded-full motion-reduce:animate-none"
        />
      )}
    </div>
  );
}
