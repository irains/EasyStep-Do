import { useDeferredValue, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  Braces,
  CheckCheck,
  Code2,
  Columns2,
  Eye,
  Link as LinkIcon,
  List,
  ListChecks,
  Minus,
  Table2,
  Quote,
  Text,
  Type,
  Strikethrough,
  WholeWord,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { openExternalUrl } from '@/api/todo'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

type Mode = 'split' | 'write' | 'preview'

export function MarkdownEditor({ value, onChange, placeholder, disabled }: MarkdownEditorProps) {
  const [mode, setMode] = useState<Mode>('split')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionRef = useRef({ start: 0, end: 0 })
  const scrollRef = useRef({ top: 0, left: 0 })
  const previewValue = useDeferredValue(value)
  const charCount = value.length

  const rememberSelection = () => {
    if (!textareaRef.current) {
      return
    }
    selectionRef.current = {
      start: textareaRef.current.selectionStart,
      end: textareaRef.current.selectionEnd,
    }
  }

  const rememberScroll = () => {
    if (!textareaRef.current) {
      return
    }
    scrollRef.current = {
      top: textareaRef.current.scrollTop,
      left: textareaRef.current.scrollLeft,
    }
  }

  const applyTransform = (
    transform: (current: string, selectionStart: number, selectionEnd: number) => {
      nextValue: string
      nextSelectionStart: number
      nextSelectionEnd: number
    },
  ) => {
    if (disabled || !textareaRef.current) {
      return
    }

    const target = textareaRef.current
    const isFocused = document.activeElement === target
    if (isFocused) {
      rememberScroll()
    }
    const savedTop = isFocused ? target.scrollTop : scrollRef.current.top
    const savedLeft = isFocused ? target.scrollLeft : scrollRef.current.left
    const selectionStart = isFocused ? target.selectionStart : selectionRef.current.start
    const selectionEnd = isFocused ? target.selectionEnd : selectionRef.current.end
    const { nextValue, nextSelectionStart, nextSelectionEnd } = transform(value, selectionStart, selectionEnd)

    onChange(nextValue)
    selectionRef.current = { start: nextSelectionStart, end: nextSelectionEnd }

    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return
      }
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(nextSelectionStart, nextSelectionEnd)
      textareaRef.current.scrollTop = savedTop
      textareaRef.current.scrollLeft = savedLeft
      scrollRef.current = { top: savedTop, left: savedLeft }
    })
  }

  const wrapSelection = (prefix: string, suffix: string, fallbackText: string) => {
    applyTransform((current, start, end) => {
      const selected = current.slice(start, end)
      const inserted = selected || fallbackText
      const before = current.slice(0, start)
      const after = current.slice(end)
      const nextValue = `${before}${prefix}${inserted}${suffix}${after}`
      const nextSelectionStart = start + prefix.length
      const nextSelectionEnd = start + prefix.length + inserted.length
      return { nextValue, nextSelectionStart, nextSelectionEnd }
    })
  }

  const insertAtCursor = (snippet: string) => {
    applyTransform((current, start, end) => {
      const before = current.slice(0, start)
      const after = current.slice(end)
      const nextValue = `${before}${snippet}${after}`
      const cursor = start + snippet.length
      return {
        nextValue,
        nextSelectionStart: cursor,
        nextSelectionEnd: cursor,
      }
    })
  }


  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) {
      return
    }

    const key = event.key.toLowerCase()
    const commandPressed = event.metaKey || event.ctrlKey
    if (!commandPressed || event.altKey) {
      return
    }

    if (key === 'b') {
      event.preventDefault()
      wrapSelection('**', '**', '粗体文本')
      return
    }

    if (key === 'i') {
      event.preventDefault()
      wrapSelection('*', '*', '斜体文本')
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-0 rounded-lg bg-muted/20 p-0.5 whitespace-nowrap">
        <ToolbarButton
          label="粗体"
          icon={<WholeWord className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => wrapSelection('**', '**', '粗体文本')}
        />
        <ToolbarButton
          label="斜体"
          icon={<Type className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => wrapSelection('*', '*', '斜体文本')}
        />
        <ToolbarButton
          label="标题"
          icon={<Text className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => insertAtCursor('## 小标题\n')}
        />
        <ToolbarButton
          label="代码"
          icon={<Braces className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => wrapSelection('`', '`', '代码')}
        />
        <ToolbarButton
          label="列表"
          icon={<List className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => insertAtCursor('- 列表项\n')}
        />
        <ToolbarButton
          label="删除线"
          icon={<Strikethrough className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => wrapSelection('~~', '~~', '删除线文本')}
        />
        <ToolbarButton
          label="任务"
          icon={<ListChecks className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => insertAtCursor('- [ ] 待办项\n')}
        />
        <ToolbarButton
          label="完成"
          icon={<CheckCheck className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => insertAtCursor('- [x] 已完成\n')}
        />
        <ToolbarButton
          label="引用"
          icon={<Quote className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => insertAtCursor('> 引用内容\n')}
        />
        <ToolbarButton
          label="链接"
          icon={<LinkIcon className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => wrapSelection('[', '](https://example.com)', '链接文字')}
        />
        <ToolbarButton
          label="代码块"
          icon={<Code2 className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => insertAtCursor('```text\n内容\n```\n')}
        />
        <ToolbarButton
          label="表格"
          icon={<Table2 className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() =>
            insertAtCursor('| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n')
          }
        />
        <ToolbarButton
          label="分割线"
          icon={<Minus className="size-3" />}
          disabled={disabled || mode === 'preview'}
          onMouseDown={rememberScroll}
          onClick={() => insertAtCursor('\n---\n')}
        />
      </div>

      <Tabs value={mode} onValueChange={(nextMode) => setMode(nextMode as Mode)} className="w-full">
        <div className="mb-2 flex items-center justify-between gap-2">
          <TabsList className="h-7 rounded-md p-0.5">
            <TabsTrigger value="split" className="min-w-[56px] gap-1 px-2 py-0.5 text-[11px]">
              <Columns2 className="size-3" />
              分屏
            </TabsTrigger>
            <TabsTrigger value="write" className="min-w-[52px] px-2 py-0.5 text-[11px]">
              编辑
            </TabsTrigger>
            <TabsTrigger value="preview" className="min-w-[52px] px-2 py-0.5 text-[11px]">
              预览
            </TabsTrigger>
          </TabsList>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Eye className="size-3" /> {charCount} 字 · Markdown · Ctrl/Cmd+B,I
          </span>
        </div>

        {mode === 'split' && (
          <div className="grid gap-2 md:grid-cols-2">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => {
                onChange(event.target.value)
                selectionRef.current = {
                  start: event.target.selectionStart,
                  end: event.target.selectionEnd,
                }
              }}
              onKeyDown={handleKeyDown}
              onSelect={() => {
                rememberSelection()
                rememberScroll()
              }}
              onClick={() => {
                rememberSelection()
                rememberScroll()
              }}
              onScroll={rememberScroll}
              onBlur={() => {
                rememberSelection()
                rememberScroll()
              }}
              placeholder={placeholder ?? '输入 Markdown 内容'}
              disabled={disabled}
              className="markdown-scrollbar h-[260px] min-h-[260px] border-border/70 bg-background/65"
            />
            <PreviewPane value={previewValue} />
          </div>
        )}

        {mode === 'write' && (
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              onChange(event.target.value)
              selectionRef.current = {
                start: event.target.selectionStart,
                end: event.target.selectionEnd,
              }
            }}
            onKeyDown={handleKeyDown}
            onSelect={() => {
              rememberSelection()
              rememberScroll()
            }}
            onClick={() => {
              rememberSelection()
              rememberScroll()
            }}
            onScroll={rememberScroll}
            onBlur={() => {
              rememberSelection()
              rememberScroll()
            }}
            placeholder={placeholder ?? '输入 Markdown 内容'}
            disabled={disabled}
            className="markdown-scrollbar h-[260px] min-h-[260px] border-border/70 bg-background/65"
          />
        )}

        {mode === 'preview' && <PreviewPane value={previewValue} />}
      </Tabs>
    </div>
  )
}

function PreviewPane({ value }: { value: string }) {
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
    <div className="markdown-scrollbar h-[260px] overflow-y-auto rounded-lg border border-border/65 bg-muted/15 p-3">
      {value.trim() ? (
        <div className="todo-markdown text-sm text-foreground">
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
        <p className="text-xs text-muted-foreground">暂无预览内容</p>
      )}
    </div>
  )
}

type ToolbarButtonProps = {
  label: string
  icon: ReactNode
  disabled?: boolean
  onMouseDown?: () => void
  onClick: () => void
}

function ToolbarButton({ label, icon, disabled, onMouseDown, onClick }: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onMouseDown={onMouseDown}
      onClick={onClick}
      disabled={disabled}
      className="h-6 gap-0.5 px-1 text-[10px]"
    >
      {icon}
      {label}
    </Button>
  )
}
