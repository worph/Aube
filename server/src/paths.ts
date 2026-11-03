import path from 'node:path'

/** Everything Aube persists lives under one directory: the container's `/data` volume. */
export interface Paths {
  root: string
  config: string
  masterPrompt: string
  memory: string
  db: string
  vapid: string
  secrets: string
}

export function pathsFor(root: string): Paths {
  const r = path.resolve(root)
  return {
    root: r,
    config: path.join(r, 'config.yaml'),
    masterPrompt: path.join(r, 'master-prompt.md'),
    memory: path.join(r, 'memory'),
    db: path.join(r, 'aube.db'),
    vapid: path.join(r, 'vapid.json'),
    secrets: path.join(r, 'secrets.env'),
  }
}
