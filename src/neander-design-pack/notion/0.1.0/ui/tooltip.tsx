// Adapted from shadcn/ui shadcn@2.1.8 (MIT). See upstream.json for source pin and adaptations.
"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "./utils"
import { useNotionThemeClass, useNotionLayerZIndex } from "./theme"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, style, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      style={{zIndex:useNotionLayerZIndex('popup')+100,...style}}
      data-ui-pack="notion"
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        useNotionThemeClass(),
        "notion-ui-tooltip-content",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
