"use client";

import {forwardRef, type ComponentPropsWithRef} from "react";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "./attachment-tooltip";
import {cn} from "../task-status/utils";

// Used upstream TooltipIconButton only: native button, exact ghost/icon classes,
// without copying the unused cva variants or installing a button dependency.
export const TooltipIconButton=forwardRef<HTMLButtonElement,ComponentPropsWithRef<"button">&{tooltip:string;side?:"top"|"bottom"|"left"|"right";tooltipContainer?:HTMLElement|null}>(
 ({children,tooltip,side="bottom",className,tooltipContainer,...rest},ref)=><TooltipProvider><Tooltip>
  <TooltipTrigger render={<button type="button" {...rest} ref={ref} className={cn("inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 hover:bg-muted hover:text-foreground aui-button-icon size-6 p-1 active:scale-90",className)}/>}>
   {children}<span className="aui-sr-only sr-only">{tooltip}</span>
  </TooltipTrigger>
  <TooltipContent side={side} container={tooltipContainer}>{tooltip}</TooltipContent>
 </Tooltip></TooltipProvider>
);
TooltipIconButton.displayName="TooltipIconButton";
