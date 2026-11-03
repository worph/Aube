import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import type { AubeConfig, Connection } from '@aube/shared'
import { ApiError, getConfig, saveConfig, testConnection, testLlm, type ConnectionProbe, type LlmProbe } from '../api'
import { Button, Card, Field, Input, Select, Status, Textarea } from '../components/ui'

/**
 * Settings (IMPLEMENTATION §11): edits `config.yaml` through the API. Every endpoint has a Test
 * that runs the real probe before anything is saved. The page renders from the config alone, so it
 * works with every port down — configuring the broken thing is exactly when it is needed.
 */
export function SettingsPage({ extra }: { extra?: ReactNode }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const [draft, setDraft] = useState<AubeConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string; issues?: string[] } | null>(null)

  useEffect(() => {
    if (q.data && !draft) setDraft(q.data.config)
  }, [q.data, draft])

  if (q.isError) return <Status ok={false}>Could not load the configuration: {(q.error as Error).message}</Status>
  if (!draft) return <p className="text-ink-500">Loading…</p>

  const set = <K extends keyof AubeConfig>(key: K, value: AubeConfig[K]) => setDraft({ ...draft, [key]: value })
  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data?.config)

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const r = await saveConfig(draft)
      qc.setQueryData(['config'], r)
      setDraft(r.config)
      setMessage({ ok: true, text: 'Saved. Applies from the next run.' })
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message, ...(err instanceof ApiError ? { issues: err.issues } : {}) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-10 flex flex-wrap items-center gap-3 rounded-lg bg-ink-50/90 py-2 backdrop-blur dark:bg-ink-950/90">
        <h1 className="text-xl font-semibold">Settings</h1>
        <div className="flex-1" />
        {message && (
          <Status ok={message.ok}>
            {message.text}
            {message.issues?.length ? (
              <ul className="list-disc pl-5">
                {message.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : null}
          </Status>
        )}
        <Button onClick={() => setDraft(q.data!.config)} disabled={!dirty || saving}>
          Revert
        </Button>
        <Button variant="primary" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {q.data!.missingVars.length > 0 && (
        <Status ok={false}>
          Environment variables referenced but not set: {q.data!.missingVars.map((v) => `\${${v}}`).join(', ')}
        </Status>
      )}

      <LlmSection llm={draft.llm} connections={Object.keys(draft.connections)} onChange={(llm) => set('llm', llm)} />
      <ScheduleSection draft={draft} set={set} />
      <ConnectionsSection connections={draft.connections} onChange={(c) => set('connections', c)} />
      <EndpointSection value={draft.mcp_endpoint} onChange={(v) => set('mcp_endpoint', v)} />
      {extra}
    </div>
  )
}

function LlmSection({ llm, connections, onChange }: { llm: AubeConfig['llm']; connections: string[]; onChange: (v: AubeConfig['llm']) => void }) {
  const [probe, setProbe] = useState<LlmProbe | null>(null)
  const [testing, setTesting] = useState(false)
  const [extra, setExtra] = useState(JSON.stringify(llm.extra_body ?? {}, null, 2))
  const [extraError, setExtraError] = useState<string | null>(null)
  const up = (patch: Partial<AubeConfig['llm']>) => onChange({ ...llm, ...patch })

  const test = async () => {
    setTesting(true)
    try {
      setProbe(await testLlm(llm))
    } catch (err) {
      setProbe({ ok: false, error: (err as Error).message, ms: 0 })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card
      title="LLM"
      actions={
        <Button onClick={test} disabled={testing || !llm.base_url}>
          {testing ? 'Testing…' : 'Test'}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Base URL" hint="Any OpenAI-compatible endpoint, e.g. http://claude-code:9091/v1">
          <Input value={llm.base_url} onChange={(e) => up({ base_url: e.target.value })} placeholder="http://host:port/v1" />
        </Field>
        <Field label="API key" hint="A ${VAR} reference, resolved from the environment">
          <Input value={llm.api_key} onChange={(e) => up({ api_key: e.target.value })} placeholder="${LLM_API_KEY}" />
        </Field>
        <Field label="Model">
          <Input value={llm.model} onChange={(e) => up({ model: e.target.value })} list="aube-models" />
          <datalist id="aube-models">{probe?.models?.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field label="Run timeout (seconds)">
          <Input type="number" min={10} value={llm.timeout_s} onChange={(e) => up({ timeout_s: Number(e.target.value) || 1800 })} />
        </Field>
        <Field
          label="Tool mode"
          hint={
            llm.tool_mode === 'backend'
              ? 'The backend uses its own connected tools (e.g. the claude-code API). Aube adds its tools through its MCP endpoint.'
              : 'A plain model: Aube runs the tool loop over its own tools and the connections below. Connectors that only exist inside a backend are not reachable this way.'
          }
        >
          <Select value={llm.tool_mode} onChange={(e) => up({ tool_mode: e.target.value as 'backend' | 'aube' })}>
            <option value="backend">backend — the LLM has its own tools</option>
            <option value="aube">aube — Aube runs the tools</option>
          </Select>
        </Field>
        {llm.tool_mode === 'aube' && (
          <>
            <Field label="Connections offered as tools">
              <div className="flex flex-wrap gap-3">
                {connections.length === 0 && <span className="text-xs text-ink-500">No connections yet.</span>}
                {connections.map((c) => (
                  <label key={c} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={llm.tool_connections.includes(c)}
                      onChange={(e) => up({ tool_connections: e.target.checked ? [...llm.tool_connections, c] : llm.tool_connections.filter((x) => x !== c) })}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Max tool rounds">
              <Input type="number" min={1} value={llm.max_tool_rounds} onChange={(e) => up({ max_tool_rounds: Number(e.target.value) || 30 })} />
            </Field>
          </>
        )}
        <Field label="Extra request body (JSON)" hint={extraError ?? 'Passed through untouched. Usually empty.'}>
          <Textarea
            rows={3}
            value={extra}
            onChange={(e) => {
              setExtra(e.target.value)
              try {
                const v = JSON.parse(e.target.value || '{}')
                setExtraError(null)
                up({ extra_body: v })
              } catch {
                setExtraError('Not valid JSON — not applied.')
              }
            }}
          />
        </Field>
      </div>
      {probe && (
        <div className="mt-3">
          <Status ok={probe.ok}>
            {probe.ok ? `Answered "${probe.reply}" in ${(probe.ms / 1000).toFixed(1)} s.` : `${probe.cls ? `[${probe.cls}] ` : ''}${probe.error}`}
            {probe.models && ` Models: ${probe.models.join(', ') || 'none listed'}.`}
          </Status>
        </div>
      )}
    </Card>
  )
}

function ScheduleSection({ draft, set }: { draft: AubeConfig; set: <K extends keyof AubeConfig>(k: K, v: AubeConfig[K]) => void }) {
  return (
    <Card title="Schedule">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Timezone">
          <Input value={draft.timezone} onChange={(e) => set('timezone', e.target.value)} />
        </Field>
        <Field label="Prepare at" hint="When the brief is prepared">
          <Input type="time" value={draft.run_at} onChange={(e) => set('run_at', e.target.value)} />
        </Field>
        <Field label="Notify at" hint="Same time every day">
          <Input type="time" value={draft.notify_at} onChange={(e) => set('notify_at', e.target.value)} />
        </Field>
        <Field label="Public URL" hint="For links in notifications">
          <Input value={draft.public_url ?? ''} onChange={(e) => set('public_url', e.target.value || undefined)} placeholder="https://aube.example.nsl.sh" />
        </Field>
      </div>
    </Card>
  )
}

const EMPTY_CONN: Connection = { transport: 'http', url: '', via: 'direct' }

function ConnectionsSection({ connections, onChange }: { connections: Record<string, Connection>; onChange: (c: Record<string, Connection>) => void }) {
  const [newName, setNewName] = useState('')
  const add = () => {
    const name = newName.trim()
    if (!name || connections[name]) return
    onChange({ ...connections, [name]: { ...EMPTY_CONN } })
    setNewName('')
  }
  return (
    <Card title="MCP connections">
      <p className="mb-3 text-sm text-ink-500">
        Beacons and MCP servers Aube can reach itself: Settings probes, notification add-ons, and the tools offered in tool mode <code>aube</code>.
      </p>
      <div className="space-y-3">
        {Object.entries(connections).map(([name, conn]) => (
          <ConnectionRow
            key={name}
            name={name}
            conn={conn}
            onChange={(c) => onChange({ ...connections, [name]: c })}
            onRemove={() => {
              const next = { ...connections }
              delete next[name]
              onChange(next)
            }}
          />
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input placeholder="name, e.g. beacon" value={newName} onChange={(e) => setNewName(e.target.value)} className="max-w-xs" />
        <Button onClick={add} disabled={!newName.trim()}>
          Add connection
        </Button>
      </div>
    </Card>
  )
}

function ConnectionRow({ name, conn, onChange, onRemove }: { name: string; conn: Connection; onChange: (c: Connection) => void; onRemove: () => void }) {
  const [probe, setProbe] = useState<ConnectionProbe | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (kind: 'connection' | 'beacon') => {
    setBusy(true)
    try {
      setProbe(await testConnection(conn, kind))
    } catch (err) {
      setProbe({ ok: false, ms: 0, error: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const up = (patch: Partial<Connection>) => onChange({ ...conn, ...patch })
  return (
    <div className="rounded-md border border-ink-200 p-3 dark:border-ink-800">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-sm font-semibold">{name}</span>
        <div className="flex-1" />
        <Button onClick={() => run('connection')} disabled={busy}>
          Test
        </Button>
        <Button onClick={() => run('beacon')} disabled={busy} title="List servers and tools (Beacon overview)">
          Discover
        </Button>
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Transport">
          <Select value={conn.transport} onChange={(e) => up({ transport: e.target.value as 'http' | 'stdio' })}>
            <option value="http">http</option>
            <option value="stdio">stdio</option>
          </Select>
        </Field>
        {conn.transport === 'http' ? (
          <div className="sm:col-span-2">
            <Field label="URL">
              <Input value={conn.url ?? ''} onChange={(e) => up({ url: e.target.value })} placeholder="http://beacon:9300/mcp/" />
            </Field>
          </div>
        ) : (
          <div className="sm:col-span-2">
            <Field label="Command (space-separated args)">
              <Input
                value={[conn.command ?? '', ...(conn.args ?? [])].join(' ').trim()}
                onChange={(e) => {
                  const [command, ...args] = e.target.value.split(' ')
                  up({ command: command ?? '', args: args.filter(Boolean) })
                }}
              />
            </Field>
          </div>
        )}
        <Field label="Via" hint={conn.via === 'beacon' ? 'tools named server__tool, called through Beacon' : undefined}>
          <Select value={conn.via} onChange={(e) => up({ via: e.target.value as 'direct' | 'beacon' })}>
            <option value="direct">direct</option>
            <option value="beacon">beacon</option>
          </Select>
        </Field>
        {conn.transport === 'http' && (
          <div className="sm:col-span-4">
            <Field label="Authorization header (optional)" hint="e.g. Bearer ${MY_TOKEN}">
              <Input
                value={conn.headers?.Authorization ?? ''}
                onChange={(e) => {
                  const headers = { ...(conn.headers ?? {}) }
                  if (e.target.value) headers.Authorization = e.target.value
                  else delete headers.Authorization
                  up({ headers })
                }}
              />
            </Field>
          </div>
        )}
      </div>
      {probe && (
        <div className="mt-2 text-sm">
          <Status ok={probe.ok}>
            {probe.ok
              ? probe.catalogue
                ? `${probe.catalogue.kind === 'beacon' ? 'Beacon' : 'Server'}: ${probe.catalogue.servers.length} server(s), ${probe.catalogue.servers.reduce((n, s) => n + s.tools.length, 0)} tool(s).`
                : `${probe.tools?.length ?? 0} tool(s)${probe.beacon ? ' — this is a Beacon; set Via to beacon and use Discover' : ''}.`
              : probe.error}
          </Status>
          {probe.catalogue && (
            <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs">
              {probe.catalogue.servers.map((s) => (
                <li key={s.name}>
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-ink-500"> — {s.tools.map((t) => t.name).join(', ') || 'no tools listed'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function EndpointSection({ value, onChange }: { value: AubeConfig['mcp_endpoint']; onChange: (v: AubeConfig['mcp_endpoint']) => void }) {
  return (
    <Card title="Aube MCP endpoint">
      <p className="mb-3 text-sm text-ink-500">
        Serves Aube's memory and brief tools at <code>/mcp</code> to the LLM backend, announced to Beacon by the beaconify sidecar. Only the run toolset is
        exposed: no settings, no master prompt.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
          Enabled
        </label>
        <Field label="Bearer token" hint="Generated on first boot into data/secrets.env">
          <Input value={value.token} onChange={(e) => onChange({ ...value, token: e.target.value })} placeholder="${AUBE_MCP_TOKEN}" />
        </Field>
      </div>
      <pre className="mt-3 overflow-auto rounded bg-ink-100 p-2 text-xs dark:bg-ink-950">{`beaconify:
  environment:
    BEACONIFY_NAME: aube
    BEACONIFY_UPSTREAM_URL: http://aube:8080/mcp
    BEACONIFY_AUTH: "Bearer \${AUBE_MCP_TOKEN}"`}</pre>
    </Card>
  )
}
