// Adapted from shadcn/ui shadcn@2.1.8 (MIT). See upstream.json for source pin and adaptations.
import * as React from "react"
import { Slot as SlotPrimitive } from "radix-ui"
const Slot = SlotPrimitive.Root
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "./utils"

const buttonVariants = cva(
  "notion-button",
  {
    variants: {
      variant: {
        default:
          "notion-ui-button-variants-2",
        destructive:
          "notion-ui-button-variants-3",
        outline:
          "notion-ui-button-variants-4",
        secondary:
          "notion-ui-button-variants-5",
        ghost: "notion-ui-button-variants-6",
        link: "notion-ui-button-variants-7",
      },
      size: {
        default: "notion-ui-button-variants-8",
        sm: "notion-ui-button-variants-9",
        lg: "notion-ui-button-variants-10",
        icon: "notion-ui-button-variants-11",
        input: "notion-button-input",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
