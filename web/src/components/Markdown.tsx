import { forwardRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Rendered markdown in the shared prose style (index.css `.prose-aube`). Raw HTML is not rendered. */
export const Markdown = forwardRef<HTMLDivElement, { text: string; className?: string }>(function Markdown({ text, className = '' }, ref) {
  return (
    <div ref={ref} className={`prose-aube ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
})
