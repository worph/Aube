import type { ConfigStore } from './config/store.js'
import type { Db } from './db/index.js'
import type { Paths } from './paths.js'

/** What every route and service is handed. Tests build it by hand. */
export interface AppContext {
  paths: Paths
  config: ConfigStore
  db: Db
  log: (msg: string) => void
  /** The clock, injectable so scheduler and run tests use fake time. */
  now: () => Date
}
