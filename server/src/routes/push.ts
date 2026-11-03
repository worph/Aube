import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Services } from '../services.js'

/** Web push for this device (Briefs header): key, subscribe, unsubscribe, status, test. */
export function registerPushRoutes(app: FastifyInstance, svc: Services) {
  app.get('/api/v1/push/key', async () => ({ publicKey: svc.push.publicKey() }))

  const Sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }), ua: z.string().optional() })
  app.post('/api/v1/push/subscribe', async (req, reply) => {
    const b = Sub.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'invalid subscription' })
    svc.push.subscribe(b.data, b.data.ua)
    return { ok: true, count: svc.push.count() }
  })

  app.post('/api/v1/push/unsubscribe', async (req) => {
    const endpoint = (req.body as { endpoint?: string })?.endpoint
    if (endpoint) svc.push.unsubscribe(endpoint)
    return { ok: true, count: svc.push.count() }
  })

  app.post('/api/v1/push/status', async (req) => {
    const endpoint = (req.body as { endpoint?: string })?.endpoint
    return { count: svc.push.count(), thisDevice: endpoint ? svc.push.has(endpoint) : false }
  })

  app.post('/api/v1/push/test', async (req) => {
    const endpoint = (req.body as { endpoint?: string })?.endpoint
    const r = await svc.push.send({ title: '☀️ Aube', body: 'Test notification: this is how your brief will arrive.', url: '/briefs' }, endpoint)
    return r
  })
}
