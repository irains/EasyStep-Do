import { forwardRef, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'min-h-[92px] w-full resize-none rounded-xl border border-border bg-background/70 px-3 py-2 text-sm outline-none transition-all focus-visible:border-border/85 focus-visible:ring-[0_0_0_1px] focus-visible:ring-foreground/22 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)

Textarea.displayName = 'Textarea'
