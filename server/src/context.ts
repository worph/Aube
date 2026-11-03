import type { ConfigStore } from './config/store.js'
import type { Db } from './db/index.js'
import type { Paths } from './paths.js'

/** What every route and service is handed. Grows per milestone; tests build it by hand. */
export interface AppContext {
  paths: Paths
  config: ConfigStore
  db: Db
  log: (msg: string) => void
}
