import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground/30 ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
