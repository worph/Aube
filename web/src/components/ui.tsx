import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

/** The handful of primitives every page uses, so pages stay about content. */

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white p-4 shadow-sm dark:border-ink-800 dark:bg-ink-900">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Button({ variant = 'default', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost' }) {
  const v = {
    default: 'border border-ink-300 bg-white hover:bg-ink-100 dark:border-ink-700 dark:bg-ink-900 dark:hover:bg-ink-800',
    primary: 'bg-amber-500 text-white hover:bg-amber-600',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'hover:bg-ink-100 dark:hover:bg-ink-800',
  }[variant]
  return <button className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-50 ${v} ${className}`} {...props} />
}

const field = 'w-full rounded-md border border-ink-300 bg-white px-2 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${field} ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${field} ${props.className ?? ''}`} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${field} font-mono ${props.className ?? ''}`} />
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink-600 dark:text-ink-300">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-500">{hint}</span>}
    </label>
  )
}

export function Status({ ok, children }: { ok: boolean | undefined; children: ReactNode }) {
  const c = ok === undefined ? 'text-ink-500' : ok ? 'text-emerald-600' : 'text-red-600'
  return <div className={`text-sm ${c}`}>{children}</div>
}
