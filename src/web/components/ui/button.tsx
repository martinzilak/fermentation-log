import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { keepUnits } from "@/lib/caps"
import { acceptPress } from "@/lib/press"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// One filled action per screen (SPEC §15.12): default is that action, secondary
// logs something, outline moves around.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-display text-xl font-bold tracking-wide uppercase whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:border disabled:border-dashed disabled:border-input disabled:bg-transparent disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6 active:brightness-90",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        // Findable, not inviting: outlined, so it never outranks the screen's action.
        destructive:
          "border-2 border-destructive bg-transparent text-destructive hover:bg-destructive/10 active:bg-destructive/10 focus-visible:ring-destructive/20",
        outline:
          "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground active:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent",
        // A picked choice: inverted, so it never reads as the screen's action.
        selected: "bg-selected text-selected-foreground",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Dirty-hands sizes (SPEC §8.1) at the 18px root: no target under 56px.
      size: {
        default: "h-14 px-5 has-[>svg]:px-4",
        lg: "h-16 w-full px-6 text-2xl",
        icon: "size-14",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  onClick,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      // Every button shares the double-tap guard (SPEC §8.1 item 4).
      onClick={onClick && ((e: React.MouseEvent<HTMLButtonElement>) => acceptPress(e) && onClick(e))}
      {...props}
    >
      {asChild ? children : keepUnits(children)}
    </Comp>
  )
}

export { Button, buttonVariants }
