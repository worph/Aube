import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { messagesFor } from '../src/notify/addons.js'
import { escapeTelegram, fillArgs, split, toPlain, toTelegram } from '../src/notify/render.js'
import { createRun, saveBrief, updateRun } from '../src/run/store.js'
import { makeServices } from '../src/services.js'
import { makeContext } from './helpers.js'
import { schema } from '../src/db/index.js'
import type { AubeConfig } from '@aube/shared'

const MD = '## 🚨 Infra\n- **api.example.com** down (502)\n\n## Tasks\n1. Fix [invoice](https://x.y/z) export\n2. Reply to `Marc`'

describe('renderers', () => {
  it('renders plain text', () => {
    expect(toPlain(MD)).toBe('🚨 Infra\n• api.example.com down (502)\n\nTasks\n1. Fix invoice (https://x.y/z) export\n2. Reply to Marc')
  })

  it('renders Telegram MarkdownV2 with every reserved character escaped', () => {
    expect(toTelegram(MD)).toBe(
      '*🚨 Infra*\n• api\\.example\\.com down \\(502\\)\n\n*Tasks*\n1\\. Fix invoice \\(https://x\\.y/z\\) export\n2\\. Reply to Marc',
    )
    expect(escapeTelegram('a_b*c[d]e(f)g~h`i>j#k+l-m=n|o{p}q.r!s\\')).toBe('a\\_b\\*c\\[d\\]e\\(f\\)g\\~h\\`i\\>j\\#k\\+l\\-m\\=n\\|o\\{p\\}q\\.r\\!s\\\\')
  })

  it('splits at line boundaries under the limit', () => {
    const parts = split(['a'.repeat(6), 'b'.repeat(6), 'c'.repeat(20)].join('\n'), 10)
    expect(parts).toEqual(['aaaaaa', 'bbbbbb', 'cccccccccc', 'cccccccccc'])
    expect(parts.every((p) => p.length <= 10)).toBe(true)
  })

  it('fills template variables in nested args', () => {
    expect(fillArgs({ text: '{{headline}} {{url}}', n: 1, list: ['{{date}}'], keep: '{{nope}}' }, { headline: 'H', url: 'U', date: 'D' })).toEqual({ text: 'H U', n: 1, list: ['D'], keep: '{{nope}}' })
  })

  it('builds headline and full messages with the deep link', () => {
    const cfg = { public_url: 'https://aube.example/' } as AubeConfig
    const b = { title: '☀️ Wed', headline: '3 meetings', markdown: MD, date: '2026-11-04' }
    const base = { name: 't', enabled: true, connection: 'c', tool: 'x', args: {} }
    expect(messagesFor({ ...base, mode: 'headline', format: 'plain' }, b, cfg)).toEqual(['☀️ Wed\n3 meetings\nhttps://aube.example/briefs/2026-11-04'])
    const full = messagesFor({ ...base, mode: 'full', format: 'telegram-markdown' }, { ...b, markdown: 'x\n'.repeat(3000) }, cfg)
    expect(full.length).toBeGreaterThan(1)
    expect(full.every((m) => m.length <= 4096)).toBe(true)
  })
})

describe('add-ons through a real MCP server', () => {
  let close: Array<() => Promise<unknown>> = []
  afterEach(async () => {
    await Promise.all(close.map((c) => c()))
    close = []
  })

  it('delivers through the tool, and a broken add-on is logged without touching the brief', async () => {
    const ctx = makeContext()
    process.env.ADDON_TEST_TOKEN = 'tok'
    const svc = makeServices(ctx)
    const app = await buildApp(ctx, svc)
    await app.listen({ port: 0, host: '127.0.0.1' })
    close.push(() => app.close())
    const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/mcp`
    await ctx.config.save({
      ...ctx.config.raw(),
      mcp_endpoint: { enabled: true, token: '${ADDON_TEST_TOKEN}' },
      connections: {
        self: { transport: 'http', url, via: 'direct', headers: { Authorization: 'Bearer ${ADDON_TEST_TOKEN}' } },
        dead: { transport: 'http', url: 'http://127.0.0.1:1/mcp', via: 'direct' },
      },
      addons: [
        { name: 'inbox', enabled: true, connection: 'self', tool: 'memory_write', mode: 'headline', format: 'plain', args: { path: 'inbox/{{date}}.md', content: '{{content}}' } },
        { name: 'broken', enabled: true, connection: 'dead', tool: 'x', mode: 'headline', format: 'plain', args: {} },
        { name: 'off', enabled: false, connection: 'dead', tool: 'x', mode: 'headline', format: 'plain', args: {} },
      ],
    })
    const run = createRun(ctx, { date: '2026-11-04', kind: 'scheduled', toolMode: 'backend', model: 'm' })
    saveBrief(ctx, run.id, '2026-11-04', { shape: 'contract', asOf: ctx.now().toISOString(), answer: { title: 'T', headline: 'H', markdown: 'M', sources: [], events: [], blocks: [], dropped: 0 } })
    updateRun(ctx, run.id, { status: 'READY' })

    svc.notifier.notifyRun(run.id)
    await svc.notifier.lastSend
    expect(await svc.memory.read('inbox/2026-11-04.md')).toMatchObject({ text: 'T\nH' })
    const sends = ctx.db.select().from(schema.notifySends).all()
    expect(sends.map((s) => [s.channel, s.status])).toEqual(
      expect.arrayContaining([
        ['in-app', 'ok'],
        ['addon:inbox', 'ok'],
        ['addon:broken', 'failed'],
      ]),
    )
    expect(sends.some((s) => s.channel === 'addon:off')).toBe(false)
  })
})
