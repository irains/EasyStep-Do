import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { openExternalUrl } from '@/api/todo'
import { cn } from '@/lib/utils'

type MarkdownPreviewProps = {
  value: string
  emptyLabel: string
  className?: string
  contentClassName?: string
}

export function MarkdownPreview({ value, emptyLabel, className, contentClassName }: MarkdownPreviewProps) {
  const handleLinkClick = async (href?: string) => {
    if (!href) {
      return
    }
    try {
      await openExternalUrl(href)
    } catch (error) {
      console.error('open external url failed:', error)
    }
  }

  return (
    <div className={cn('markdown-scrollbar overflow-y-auto rounded-lg border border-border/65 bg-muted/15 p-3', className)}>
      {value.trim() ? (
        <div className={cn('todo-markdown text-sm text-foreground', contentClassName)}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
            components={{
              a: ({ href, children, ...props }) => (
                <a
                  {...props}
                  href={href}
                  className="text-sky-600 underline underline-offset-2 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300"
                  onClick={(event) => {
                    event.preventDefault()
                    void handleLinkClick(href)
                  }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {value}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  )
}
