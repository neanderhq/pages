// Adapted from shadcn/ui shadcn@2.1.8 (MIT). See upstream.json for source pin and adaptations.
"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "./utils"
import { useNotionThemeClass, useNotionLayerZIndex } from "./theme"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & { padding?: 'default' | 'none'; container?: HTMLElement | null }
>(({ className, style, align = "center", sideOffset = 4, padding = 'default', container, ...props }, ref) => (
  <PopoverPrimitive.Portal container={container??undefined}>
    <PopoverPrimitive.Content
      style={{zIndex:useNotionLayerZIndex('popup'),...style}}
      data-ui-pack="notion"
      data-padding={padding}
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        useNotionThemeClass(),
        "notion-ui-popover-content",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
