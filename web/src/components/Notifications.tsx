import { useEffect, useState } from 'react'
import { api } from '../api'
import { currentSubscription, pushSupported, subscribeToPush, unsubscribeFromPush } from '../push'
import { InstallButton } from './InstallButton'
import { Button, Status } from './ui'

/** Notifications on this device (Briefs header): subscribe, unsubscribe, send a test. */
export function Notifications() {
  const [state, setState] = useState<{ thisDevice: boolean; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = async () => {
    const sub = await currentSubscription().catch(() => null)
    const s = await api<{ count: number; thisDevice: boolean }>('/api/v1/push/status', { method: 'POST', json: { endpoint: sub?.endpoint } }).catch(() => null)
    if (s) setState({ count: s.count, thisDevice: !!sub && s.thisDevice })
  }
  useEffect(() => {
    void refresh()
  }, [])

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-800 dark:bg-ink-900">
      <span>🔔</span>
      {!pushSupported() ? (
        <span className="text-ink-500">This browser cannot receive push notifications. On a phone, install Aube first.</span>
      ) : state?.thisDevice ? (
        <>
          <span>Notifications are on for this device.</span>
          <Button disabled={busy} onClick={() => act(async () => {
            const sub = await currentSubscription()
            const r = await api<{ sent: number; failed: string[] }>('/api/v1/push/test', { method: 'POST', json: { endpoint: sub?.endpoint } })
            setMsg(r.sent ? { ok: true, text: 'Test sent.' } : { ok: false, text: r.failed.join('; ') || 'Nothing was sent.' })
          })}>
            Send a test
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => act(unsubscribeFromPush)}>
            Turn off
          </Button>
        </>
      ) : (
        <>
          <span className="text-ink-500">Get a notification when the brief is ready.</span>
          <Button variant="primary" disabled={busy} onClick={() => act(async () => {
            const r = await subscribeToPush()
            setMsg(r.ok ? { ok: true, text: 'Notifications are on for this device.' } : { ok: false, text: r.reason ?? 'Could not subscribe.' })
          })}>
            Turn on notifications
          </Button>
        </>
      )}
      {state && state.count > 0 && <span className="text-xs text-ink-500">{state.count} device(s) subscribed</span>}
      <div className="flex-1" />
      <InstallButton />
      {msg && <Status ok={msg.ok}>{msg.text}</Status>}
    </div>
  )
}
