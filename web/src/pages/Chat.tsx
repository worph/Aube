import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { confirmProposal, getChat, newThread, streamPost, type ChatMessage } from '../api'
import { Markdown } from '../components/Markdown'
import { MemoryPanel } from '../components/MemoryPanel'
import { Button, Status, Textarea } from '../components/ui'

/**
 * The administrator chat (ARCHITECTURE §7) beside the memory panel. Aube owns the loop and the
 * tools; each tool call is a row, and writes that need confirmation arrive as cards.
 */
export function ChatPage() {
  const qc = useQueryClient()
  const [thread, setThread] = useState<number | undefined>(undefined)
  const chat = useQuery({ queryKey: ['chat', thread], queryFn: () => getChat(thread) })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<'chat' | 'memory'>('chat')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (chat.data) setMessages(chat.data.messages)
  }, [chat.data])
  // Braces matter: newer browsers return a Promise from scrollIntoView, and React would call it as a cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const upsert = (m: ChatMessage) => setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur.map((x) => (x.id === m.id ? m : x)) : [...cur, m]))

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    setInput('')
    try {
      await streamPost('/api/v1/chat/messages', { message: text }, (ev) => {
        if (ev?.type === 'message') upsert(ev.message)
        if (ev?.type === 'thread' && thread !== undefined && ev.threadId !== thread) setThread(ev.threadId)
      })
    } catch (err) {
      setError((err as Error).message)
      setInput(text)
    } finally {
      setBusy(false)
      void qc.invalidateQueries({ queryKey: ['chat'] })
      void qc.invalidateQueries({ queryKey: ['memory'] })
      void qc.invalidateQueries({ queryKey: ['memory-history'] })
    }
  }

  const fresh = async () => {
    try {
      const r = await newThread()
      setThread(r.threadId)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const inference = chat.data?.inference
  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col gap-3 sm:h-[calc(100dvh-6rem)]">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Chat</h1>
        <div className="flex gap-1 lg:hidden">
          <Button variant={mobileTab === 'chat' ? 'default' : 'ghost'} onClick={() => setMobileTab('chat')}>
            Chat
          </Button>
          <Button variant={mobileTab === 'memory' ? 'default' : 'ghost'} onClick={() => setMobileTab('memory')}>
            Memory
          </Button>
        </div>
        <div className="flex-1" />
        {chat.data && chat.data.threads.length > 1 && (
          <select className="rounded border border-ink-300 bg-white px-2 py-1 text-sm dark:border-ink-700 dark:bg-ink-900" value={chat.data.threadId ?? ''} onChange={(e) => setThread(Number(e.target.value))}>
            {chat.data.threads.map((t) => (
              <option key={t.id} value={t.id}>
                Conversation {t.id} · {new Date(t.lastAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        )}
        <Button onClick={fresh} disabled={busy}>
          New conversation
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_24rem]">
        <section className={`flex min-h-0 flex-col rounded-lg border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900 ${mobileTab === 'chat' ? '' : 'hidden lg:flex'}`}>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
            {inference && !inference.available && (
              <Status ok={false}>
                {inference.reason}{' '}
                <Link to="/settings" className="underline">
                  Open Settings
                </Link>
              </Status>
            )}
            {messages.length === 0 && inference?.available && (
              <div className="text-sm text-ink-500">
                Ask me to connect a Beacon, draft your master prompt, or remember something. For example: <em>“Write a master prompt: sport on Monday and Wednesday, fish on Friday, check my calendar and mail.”</em>
              </div>
            )}
            {messages.map((m) => (
              <Row key={m.id} m={m} onSettled={upsert} />
            ))}
            {busy && <div className="text-sm text-ink-500">Thinking…</div>}
            <div ref={bottom} />
          </div>
          {error && (
            <div className="px-3">
              <Status ok={false}>{error}</Status>
            </div>
          )}
          <div className="flex gap-2 border-t border-ink-200 p-2 dark:border-ink-800">
            <Textarea
              rows={2}
              className="font-sans"
              value={input}
              placeholder={inference?.available === false ? 'Configure the LLM in Settings first' : 'Message Aube…  (Enter to send, Shift+Enter for a new line)'}
              disabled={busy || inference?.available === false}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <Button variant="primary" onClick={send} disabled={busy || !input.trim() || inference?.available === false}>
              Send
            </Button>
          </div>
        </section>
        <aside className={`min-h-0 rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-900 ${mobileTab === 'memory' ? '' : 'hidden lg:block'}`}>
          <MemoryPanel />
        </aside>
      </div>
    </div>
  )
}

function Row({ m, onSettled }: { m: ChatMessage; onSettled: (m: ChatMessage) => void }) {
  const [working, setWorking] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (m.role === 'user') return <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-amber-100 px-3 py-2 text-sm dark:bg-amber-900/40">{m.body}</div>
  if (m.role === 'assistant')
    return (
      <div className="max-w-[90%] rounded-lg bg-ink-100 px-3 py-2 text-sm dark:bg-ink-800">
        <Markdown text={m.body} />
      </div>
    )

  if (m.confirmWith) {
    const decide = async (d: 'confirm' | 'cancel') => {
      setWorking(true)
      setErr(null)
      try {
        onSettled((await confirmProposal(m.id, d)).message)
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setWorking(false)
      }
    }
    return (
      <div className="rounded-lg border-2 border-amber-400 p-3 text-sm">
        <div className="mb-1 font-medium">
          Proposed: <code>{m.tool}</code>
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-ink-50 p-2 text-xs dark:bg-ink-950">{m.confirmWith}</pre>
        {m.confirmedAt ? (
          <Status ok={!!m.ok}>{m.result}</Status>
        ) : (
          <div className="mt-2 flex gap-2">
            <Button variant="primary" disabled={working} onClick={() => decide('confirm')}>
              Confirm
            </Button>
            <Button disabled={working} onClick={() => decide('cancel')}>
              Cancel
            </Button>
          </div>
        )}
        {err && <Status ok={false}>{err}</Status>}
      </div>
    )
  }

  return (
    <details className="rounded border border-ink-200 px-2 py-1 text-xs dark:border-ink-700">
      <summary className="cursor-pointer select-none">
        <span className={m.ok ? 'text-emerald-600' : 'text-red-600'}>{m.ok ? '✓' : '✗'}</span> <code>{m.tool}</code>
        <span className="text-ink-500"> {JSON.stringify(m.args ?? {}).slice(0, 80)}</span>
      </summary>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap">{m.result}</pre>
    </details>
  )
}
