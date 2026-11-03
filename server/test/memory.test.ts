import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../src/memory/store.js'
import { makeContext, tempDir } from './helpers.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function store() {
  const ctx = makeContext()
  return { ctx, mem: new MemoryStore(ctx) }
}

describe('memory store', () => {
  it('refuses paths that leave the folder, hidden files and other types', async () => {
    const { mem } = store()
    for (const bad of ['../x.md', '/etc/x.md', 'a/../../x.md', 'C:/x.md', '.secret.md', 'notes.txt', 'x.md\0', '']) {
      await expect(mem.write(bad, 'x', { by: 'ui' })).rejects.toThrow()
    }
    await expect(mem.write('a/./b/../c.md', 'ok', { by: 'ui' })).resolves.toMatchObject({ path: 'a/c.md' })
  })

  it('refuses symlinks inside the folder', async () => {
    const { mem, ctx } = store()
    const outside = tempDir()
    writeFileSync(path.join(outside, 'target.md'), 'secret')
    symlinkSync(outside, path.join(ctx.paths.memory, 'link'))
    await expect(mem.read('link/target.md')).rejects.toThrow(/symbolic/)
    await expect(mem.write('link/new.md', 'x', { by: 'ui' })).rejects.toThrow(/symbolic/)
    expect((await mem.list()).some((f) => f.path.startsWith('link'))).toBe(false)
  })

  it('enforces size caps', async () => {
    const { mem, ctx } = store()
    await ctx.config.save({ ...ctx.config.raw(), memory: { max_file_kb: 1, max_image_kb: 1, max_total_mb: 1 } })
    await expect(mem.write('big.md', 'x'.repeat(2000), { by: 'ui' })).rejects.toThrow(/limit/)
  })

  it('journals writes and deletes, and restores a deleted file', async () => {
    const { mem } = store()
    await mem.write('health.md', 'knee: no running', { by: 'run:7', runId: 7 })
    await mem.write('health.md', 'knee: better', { by: 'chat:1' })
    await mem.delete('health.md', { by: 'chat:1' })
    await expect(mem.read('health.md')).rejects.toThrow(/no such/)
    const h = mem.history('health.md')
    expect(h.map((e) => [e.action, e.by])).toEqual([
      ['delete', 'chat:1'],
      ['write', 'chat:1'],
      ['write', 'run:7'],
    ])
    await mem.restore(h[0]!.id, { by: 'ui' })
    expect(await mem.read('health.md')).toMatchObject({ text: 'knee: better' })
    await mem.restore(h[2]!.id, { by: 'ui' })
    expect(await mem.read('health.md')).toMatchObject({ text: 'knee: no running' })
    expect(mem.touchedBy(7)).toEqual(['health.md'])
  })

  it('round-trips images and flags files missing from the index', async () => {
    const { mem } = store()
    await mem.write('images/dot.png', PNG, { by: 'ui' })
    expect(await mem.read('images/dot.png')).toMatchObject({ kind: 'image', data: PNG, mimeType: 'image/png' })
    await expect(mem.write('images/bad.png', 'not base64!!', { by: 'ui' })).rejects.toThrow(/base64/)
    const list = await mem.list()
    expect(list[0]!.path).toBe('MEMORY.md')
    expect(list.find((f) => f.path === 'images/dot.png')!.inIndex).toBe(false)
  })

  it('removes emptied directories', async () => {
    const { mem, ctx } = store()
    mkdirSync(path.join(ctx.paths.memory, 'deep'), { recursive: true })
    await mem.write('deep/x.md', 'x', { by: 'ui' })
    await mem.delete('deep/x.md', { by: 'ui' })
    expect((await mem.list()).map((f) => f.path)).toEqual(['MEMORY.md'])
  })
})
