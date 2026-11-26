// Adapted from shadcn/ui shadcn@2.1.8 (MIT). See upstream.json for source pin and adaptations.
"use client"

import * as React from "react"
import { Switch as SwitchPrimitives } from "radix-ui"

import { cn } from "./utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "notion-ui-switch",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "notion-ui-switch-2"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
