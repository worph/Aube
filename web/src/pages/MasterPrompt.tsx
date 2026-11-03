import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { getPrompt, getPromptVersion, getRun, isRunning, restorePrompt, savePrompt, startRun } from '../api'
import { BriefDisplay } from '../components/BriefDisplay'
import { Diff } from '../components/Diff'
import { Button, Card, Input, Select, Status, Textarea } from '../components/ui'

/** What goes into the brief, in prose. Every save is a version; Preview runs it now without notifying. */
export function MasterPromptPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['prompt'], queryFn: getPrompt })
  const [body, setBody] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [previewPhase, setPreviewPhase] = useState<'morning' | 'evening'>('morning')

  useEffect(() => {
    if (q.data && body === null) setBody(q.data.body)
  }, [q.data, body])

  const version = useQuery({ queryKey: ['prompt-version', viewing], queryFn: () => getPromptVersion(viewing!), enabled: viewing !== null })
  const preview = useQuery({
    queryKey: ['run', previewId],
    queryFn: () => getRun(previewId!),
    enabled: previewId !== null,
    refetchInterval: (qq) => (isRunning(qq.state.data?.run.status) || !qq.state.data ? 2000 : false),
  })
  const briefs = useQuery({ queryKey: ['briefs'], queryFn: () => import('../api').then((m) => m.getBriefs()) })

  if (q.isError) return <Status ok={false}>{(q.error as Error).message}</Status>
  if (!q.data || body === null) return <p className="text-ink-500">Loading…</p>
  const dirty = body !== q.data.body

  const save = async () => {
    try {
      await savePrompt(body, note || undefined)
      setNote('')
      setMsg({ ok: true, text: 'Saved as a new version. The next run uses it.' })
      const fresh = await qc.fetchQuery({ queryKey: ['prompt'], queryFn: getPrompt })
      setBody(fresh.body)
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    }
  }

  const runPreview = async () => {
    try {
      if (dirty) await save()
      const { runId } = await startRun('preview', undefined, previewPhase)
      setPreviewId(runId)
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    }
  }

  const restore = async (id: number) => {
    await restorePrompt(id)
    const fresh = await qc.fetchQuery({ queryKey: ['prompt'], queryFn: getPrompt })
    setBody(fresh.body)
    setViewing(null)
    setMsg({ ok: true, text: `Restored version ${id} as a new version.` })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Master prompt</h1>
        <span className="text-sm text-ink-500">What you want in the brief, in your own words. Day-specific wishes go here too.</span>
      </div>
      {msg && <Status ok={msg.ok}>{msg.text}</Status>}
      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <Card>
          <Textarea rows={22} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-sm" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input placeholder="Note for this version (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-sm" />
            <div className="flex-1" />
            <Button onClick={() => setBody(q.data!.body)} disabled={!dirty}>
              Revert
            </Button>
            <Button onClick={save} disabled={!dirty}>
              Save
            </Button>
            <Select
              aria-label="Which run to preview"
              className="w-auto"
              value={previewPhase}
              onChange={(e) => setPreviewPhase(e.target.value as 'morning' | 'evening')}
              title="Morning: today's brief. Evening: tomorrow's preview with the wake-up time."
            >
              <option value="morning">☀️ Morning</option>
              <option value="evening">🌙 Evening</option>
            </Select>
            <Button variant="primary" onClick={runPreview} disabled={previewId !== null && isRunning(preview.data?.run.status)}>
              {previewId !== null && (isRunning(preview.data?.run.status) || !preview.data) ? 'Preview running…' : 'Preview'}
            </Button>
          </div>
        </Card>
        <Card title="Versions">
          <ul className="max-h-[32rem] space-y-1 overflow-auto text-sm">
            {q.data.versions.map((v) => (
              <li key={v.id}>
                <button className={`w-full rounded px-2 py-1 text-left hover:bg-ink-100 dark:hover:bg-ink-800 ${viewing === v.id ? 'bg-ink-100 dark:bg-ink-800' : ''}`} onClick={() => setViewing(viewing === v.id ? null : v.id)}>
                  <div>
                    #{v.id} {v.id === q.data!.versionId && <span className="text-emerald-600">current</span>}
                  </div>
                  <div className="text-xs text-ink-500">
                    {new Date(v.savedAt).toLocaleString()} · {v.savedBy}
                    {v.note ? ` · ${v.note}` : ''}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {viewing !== null && version.data && (
        <Card title={`Version #${viewing} → current`} actions={viewing !== q.data.versionId && <Button onClick={() => restore(viewing)}>Restore this version</Button>}>
          <Diff before={version.data.body} after={q.data.body} />
        </Card>
      )}
      {previewId !== null && (
        <Card title={`Preview (run #${previewId})`}>
          {!preview.data || isRunning(preview.data.run.status) ? (
            <p className="text-sm text-ink-500">Running… a real brief can take several minutes while the LLM gathers your day.</p>
          ) : preview.data.brief ? (
            <BriefDisplay brief={preview.data.brief} timezone={briefs.data?.schedule.timezone ?? 'UTC'} today={briefs.data?.today ?? ''} />
          ) : (
            <Status ok={false}>The preview produced no brief.</Status>
          )}
        </Card>
      )}
    </div>
  )
}
