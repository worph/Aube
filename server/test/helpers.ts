import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ConfigStore } from '../src/config/store.js'
import { openDb } from '../src/db/index.js'
import { firstBoot } from '../src/firstboot.js'
import { pathsFor } from '../src/paths.js'
import type { AppContext } from '../src/context.js'

export function tempDir(prefix = 'aube-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

/** A fresh data dir with first-boot files, an in-file DB and a ConfigStore. */
export function makeContext(): AppContext {
  const paths = pathsFor(tempDir())
  firstBoot(paths, () => {})
  return { paths, config: new ConfigStore(paths.config), db: openDb(paths.db), log: () => {}, now: () => new Date() }
}
