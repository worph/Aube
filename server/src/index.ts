import { ConfigStore } from './config/store.js'
import { openDb } from './db/index.js'
import { firstBoot } from './firstboot.js'
import { pathsFor } from './paths.js'
import { buildApp } from './app.js'
import type { AppContext } from './context.js'
import { makeServices } from './services.js'

const log = (msg: string) => console.log(`[aube] ${msg}`)

async function main() {
  const paths = pathsFor(process.env.AUBE_DATA_DIR ?? './data')
  firstBoot(paths, log)
  const config = new ConfigStore(paths.config)
  const db = openDb(paths.db)
  const ctx: AppContext = { paths, config, db, log, now: () => new Date() }
  const svc = makeServices(ctx)

  const app = await buildApp(ctx, svc, { serveWeb: true })
  const port = Number(process.env.AUBE_PORT ?? 8080)
  await app.listen({ host: '0.0.0.0', port })
  log(`listening on :${port}, data in ${paths.root}`)
  svc.scheduler.start()

  const stop = async () => {
    svc.scheduler.stop()
    await app.close().catch(() => undefined)
    db.$client.close()
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
