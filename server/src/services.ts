import { MemoryStore } from './memory/store.js'
import { Notifier } from './notify/index.js'
import { PushService } from './notify/push.js'
import { addonChannels } from './notify/addons.js'
import { makeToolLoop } from './llm/tool-loop.js'
import { Runner, type RunnerOptions } from './run/runner.js'
import { Scheduler } from './scheduler.js'
import type { AppContext } from './context.js'

/** The long-lived services, wired once. Tests call `makeServices` with a fake clock and sleep. */
export interface Services {
  runner: Runner
  notifier: Notifier
  scheduler: Scheduler
  memory: MemoryStore
  push: PushService
}

export function makeServices(ctx: AppContext, opts: Omit<RunnerOptions, 'onDone'> = {}): Services {
  const notifier = new Notifier(ctx)
  const push = new PushService(ctx)
  notifier.addChannel(push.channel())
  notifier.addProvider(() => addonChannels(ctx))
  let scheduler: Scheduler | undefined
  let services: Services | undefined
  const runner = new Runner(ctx, { toolLoop: makeToolLoop(() => services!), ...opts, onDone: (id) => scheduler?.onRunDone(id) })
  scheduler = new Scheduler(ctx, runner, notifier)
  services = { runner, notifier, scheduler, memory: new MemoryStore(ctx), push }
  return services
}
