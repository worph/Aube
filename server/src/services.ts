import { MemoryStore } from './memory/store.js'
import { Notifier } from './notify/index.js'
import { Runner, type RunnerOptions } from './run/runner.js'
import { Scheduler } from './scheduler.js'
import type { AppContext } from './context.js'

/** The long-lived services, wired once. Tests call `makeServices` with a fake clock and sleep. */
export interface Services {
  runner: Runner
  notifier: Notifier
  scheduler: Scheduler
  memory: MemoryStore
}

export function makeServices(ctx: AppContext, opts: Omit<RunnerOptions, 'onDone'> = {}): Services {
  const notifier = new Notifier(ctx)
  let scheduler: Scheduler | undefined
  const runner = new Runner(ctx, { ...opts, onDone: (id) => scheduler?.onRunDone(id) })
  scheduler = new Scheduler(ctx, runner, notifier)
  return { runner, notifier, scheduler, memory: new MemoryStore(ctx) }
}
