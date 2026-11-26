// Adapted from shadcn/ui shadcn@2.1.8 (MIT). See upstream.json for source pin and adaptations.
import * as React from "react"

import { cn } from "./utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "notion-ui-textarea",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
