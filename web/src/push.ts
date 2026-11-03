import { api } from './api'

/** Web push in the browser, ported from Newsdesk web/src/push.ts. */

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return undefined
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const view = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return view
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function subscribeToPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'This browser does not support web push (on iOS, install the app to the home screen first).' }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'Notifications were not allowed for this site.' }
  const registration = await navigator.serviceWorker.ready
  const { publicKey } = await api<{ publicKey: string }>('/api/v1/push/key')
  const existing = await registration.pushManager.getSubscription()
  // A subscription made under another server key can never receive our pushes.
  if (existing) await existing.unsubscribe()
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } }
  if (!json.endpoint || !json.keys) return { ok: false, reason: 'The browser returned an unusable subscription.' }
  await api('/api/v1/push/subscribe', { method: 'POST', json: { endpoint: json.endpoint, keys: json.keys, ua: navigator.userAgent } })
  return { ok: true }
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  await api('/api/v1/push/unsubscribe', { method: 'POST', json: { endpoint: subscription.endpoint } }).catch(() => undefined)
  await subscription.unsubscribe()
}
