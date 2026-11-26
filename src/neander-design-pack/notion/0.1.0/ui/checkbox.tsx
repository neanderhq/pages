// Adapted from shadcn/ui shadcn@2.1.8 (MIT). See upstream.json for source pin and adaptations.
"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { Check } from "./icons"

import { cn } from "./utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "notion-ui-checkbox",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("notion-ui-checkbox-2")}
    >
      <Check className="notion-ui-checkbox-3" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
