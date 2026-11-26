// Adapted from shadcn/ui shadcn@2.1.8 (MIT). See upstream.json for source pin and adaptations.
import * as React from "react"

import { cn } from "./utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input"> & { variant?: 'field' | 'embedded' }>(
  ({ className, type, variant = 'field', ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot="input"
        data-appearance={variant}
        className={cn(
          "notion-ui-input",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
