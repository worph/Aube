## overview

**Aube is a self-hosted morning brief.** Once a night it hands an LLM backend the user's **master
prompt** (what they want in the brief, in their own words), today's date and Aube's **memory**.
The backend gathers the day with the tools it is already connected to (mail, calendar, tasks,
monitors, recipes, training…) and answers once. Aube stores that answer as the day's **brief**,
and a web push tells the user it is ready. *Aube* is French for "dawn".

What a night looks like:

1. At `run_at` (e.g. 05:00) Aube sends the master prompt, the memory index and the date to the
   LLM backend (any OpenAI-compatible endpoint, typically the Claude Code app).
2. The backend uses its own tools, plus Aube's memory tools if it can reach them.
3. Aube stores the brief: markdown text, a headline, and a **day band**. The day band is a
   00:00–24:00 timeline with the day's calendar events and, in a lighter lane, the proposed
   time-blocked plan.
4. At `notify_at` (e.g. 07:00) a web push goes out, and so does any notification add-on (Telegram…).

Optionally an **evening preview** (`evening_at`, e.g. 21:00) prepares tomorrow's brief the evening
before, with a **recommended wake-up time**, and notifies at once so the user can set an alarm.

Aube owns only four things: the master prompt, the memory, the schedule and the archive of
briefs. **It never copies the state of other tools.** A task's status lives in Trello, an event in
the calendar, a mail in the mailbox, and each night the backend asks them again. Memory holds
context that no tool knows (preferences, an injury, a photo of a timetable).

The brief is plain information: no buttons, no replies. To change tomorrow's brief, change the
master prompt or the memory.

The app has four pages: **Chat** (an administrator chat with the same powers as these tools),
**Master prompt** (editor, history, Preview), **Briefs** (one per day with its day band, the run
log, and phone notifications), **Settings**. Access to the app goes through the box's login
(AppShield); `aube_status` gives its address.

These tools (`aube-admin__*`) do everything the administrator chat does. `aube_status` says what
is set up and what is missing.

## getting-started

Call `aube_status` first: it ticks each step below and gives the app's address.

1. **LLM endpoint**: `settings_save {"llm": {"base_url": "http://<host>:<port>/v1", "model": "<model>"}}`.
   On a Yundera box this is usually the Claude Code app's OpenAI-compatible API (turned on in that
   app with `OPENAI_API_ENABLED=true`). Aube only needs a base URL.
2. **Its bearer**: `secret_set {"name": "LLM_API_KEY", "value": "…"}` (write-only; for Claude
   Code it is that app's password). Then `llm_test`: it should list models and answer "OK".
3. **Memory tools for the nightly run**: `settings_save {"mcp_endpoint": {"enabled": true}}`. The
   backend then reaches `aube__memory_*` through Beacon. Without this, memory is read-only for runs.
4. **Data sources**: check what the backend can use with `backend_ask` ("Which MCP tools can you
   use? List them."). See topic `sources`: they are configured in the backend, not in Aube.
5. **Master prompt**: write what the user wants (topic `master-prompt`) and `prompt_save` it.
6. **Try it**: `run_preview` (it doesn't notify or replace the day's brief), wait 1–5 minutes, then
   `run_get` to read the result. Refine the prompt and preview again.
7. **Schedule**: `run_at`, `notify_at`, `timezone`; optionally `evening_at` (topic `settings`).
8. **Phone notifications**: the user opens the app on their phone; see topic `notifications`.

## master-prompt

The master prompt is plain text in the user's own words: what goes into the brief, in what order,
in what language, with which rules. The backend reads it every night together with the date and the
memory. Good prompts are concrete about sources, order, rules per weekday, and the plan.

Example:

```markdown
Organise my day. Write in French, readable in under two minutes.

1. Infra first: anything down or flapping overnight in Uptime Robot.
2. My calendar for today, and tomorrow morning if it starts before 9:00. Flag conflicts.
3. Mail since yesterday: only what needs an action from me.
4. Trello: my open cards by urgency (overdue, due today, label "urgent", due this week).
5. Sport: Monday and Wednesday, from my wger routine. Put it at 12:30 or 18:30, whichever is free.
   Never two leg days in a row.
6. Meals from Mealie. On Friday I want fish. Quick recipes on days with more than 5h of meetings.
7. End with a time-blocked plan of the day. I work 9:00 to 18:00, deep work in the morning.
8. In the evening preview, tell me when to wake up: 45 min before I must leave, never before
   6:00, 7h30 of sleep if the day allows it.
```

What a brief can contain (Aube asks the backend for it, the prompt doesn't need to): a title, a
one-line headline (used in notifications), markdown sections, the day's **events** and a
**plan** of time blocks (kinds: focus, task, meeting-prep, sport, meal, travel, break, other),
shown on the day band, and in an evening preview a **wake-up** time with its reason.

Tips:
- Name the sources ("from my wger routine", "in Trello") so the backend knows which tool to use.
  Only tools the backend can reach work (topic `sources`).
- Put lasting personal context (allergies, an injury, a training plan) in **memory**, not in the
  prompt: `memory_write`, and keep `MEMORY.md` as the index.
- Always send the **full text** to `prompt_save`; each save is a new version. `prompt_versions`
  lists them and `prompt_get {"version": N}` reads an old one. To restore it, `prompt_save` its
  text with the note "restored #N".
- After a change, `run_preview` then `run_get` to see the effect.

## settings

`settings_get` returns the configuration; `settings_save` takes a **partial** object merged into it
(`null` removes a key). It is validated and refused if invalid. Secrets are never written as
values: a secret field holds a `${VAR}` reference, whose value is set with `secret_set`.

| Key | Meaning |
|---|---|
| `timezone` | IANA zone for every time below, e.g. `Europe/Paris` |
| `run_at` | `HH:MM`, when the morning brief is prepared |
| `notify_at` | `HH:MM`, when the push goes out (or as soon as the brief is ready, if later) |
| `morning_run` | `true`/`false`. Off means only the evening preview runs |
| `evening_at` | `HH:MM` for the evening preview of tomorrow (with a wake-up time), or `""` for none. With `morning_run` off, `evening_at` must be set |
| `public_url` | the app's address, for links in notifications. Usually filled from the platform |
| `llm.base_url` | OpenAI-compatible base URL, e.g. `http://claude-router:9091/v1` |
| `llm.api_key` | `${LLM_API_KEY}` (set the value with `secret_set`) |
| `llm.model` | model id the endpoint accepts, e.g. `sonnet`, `opus` |
| `llm.tool_mode` | `backend` (default: the backend uses its own tools) or `aube` (a plain model; Aube runs the tool loop over its own tools and `llm.tool_connections`) |
| `llm.timeout_s` | per-run timeout in seconds (default 1800) |
| `llm.extra_body` | extra fields passed untouched in each request |
| `llm.tool_connections`, `llm.max_tool_rounds` | tool mode `aube` only |
| `connections` | named MCP connections `{transport: http, url, headers?, via: direct|beacon}`, used by tool mode `aube` and by add-ons |
| `mcp_endpoint.enabled` | Aube's memory and brief tools at `/mcp` for the nightly backend (as `aube` on Beacon) |
| `admin_endpoint.enabled` | these admin tools at `/mcp/admin` (as `aube-admin` on Beacon) |
| `memory.max_file_kb`, `max_image_kb`, `max_total_mb` | memory limits |
| `retention.artifact_days` | how long run logs (messages, raw answers) are kept |
| `addons` | notification add-ons, see below |

**Add-ons** send the brief through an MCP tool when it is notified. Each one is:

```json
{"name": "telegram", "enabled": true, "connection": "beacon", "tool": "telegram-mcp__send_message",
 "mode": "headline", "format": "telegram-markdown", "args": {"text": "{{content}}"}}
```

`mode` is `headline` (title, headline and link) or `full` (the whole brief, rendered for the
channel); `format` is `telegram-markdown` or `plain`; `args` are the tool's arguments, with
`{{content}} {{headline}} {{title}} {{url}} {{date}}` filled in. `connection` names an entry of
`connections`, for example a Beacon:
`{"beacon": {"transport": "http", "url": "http://beacon:9300/mcp/", "via": "beacon"}}`.
Check it with `connection_test` or `beacon_discover`, then send a test message with `addon_test`.
`settings_save` replaces the `addons` list as a whole, so send the full list.

## sources

In tool mode `backend` (the default), **the data sources are the LLM backend's own tools, not
Aube's.** Aube sends no tool list: the backend uses whatever it is connected to, e.g. the Claude
Code app's claude.ai connectors (Gmail, Calendar, Drive…) and the box's Beacon (Trello, Uptime
Robot, Mealie, wger…). Aube cannot add a source.

- To see what the backend can reach: `backend_ask` with "Which MCP tools can you use? List them."
  (its answer describes itself and is not a guarantee).
- To add a source: connect it to the backend. For Claude Code, that means a claude.ai connector
  on the same account, or an app on the box's Beacon. Then name it in the master prompt.
- `connections` in Settings do **not** add sources in `backend` mode. They are for tool mode
  `aube` (a plain model with no tools of its own) and for notification add-ons.

## notifications

- **In-app**: every brief is on the Briefs page.
- **Web push on a phone or computer**: it is turned on **per device, from the app itself**. Open
  the app (address from `aube_status`) on that device, go to **Briefs**, and enable
  notifications. On iPhone, first add the app to the home screen (Share → Add to Home Screen) and
  open it from there; Android and desktop browsers work directly. This can't be done through these
  tools. `aube_status` says how many devices are subscribed.
- The morning brief is notified at `notify_at` (or as soon as it is ready, if later). The evening
  preview is notified as soon as it is ready, with the wake-up time first.
- **Add-ons** (Telegram, Discord, ntfy…) send the brief through an MCP tool too: topic `settings`,
  then `addon_test`.

## troubleshooting

- **Did it run, and how did it go?** `run_list` (recent runs) and `run_get` (one run and its brief).
  Statuses: PENDING, RUNNING, READY (stored), NOTIFIED (stored and sent), FAILED.
- **Failure classes**: `auth` (the backend refused the bearer: `secret_set LLM_API_KEY`, then
  `llm_test`) · `unreachable` (wrong `llm.base_url`, or the backend is down: `llm_test`) · `busy`
  (the backend stayed busy until the notification time) · `error` (the backend failed twice) ·
  `parse-failed` (the answer could not be used). A failed run still stores a "no brief" brief.
- **A source is missing from the brief**: `backend_ask` for the backend's tools (topic `sources`),
  then make the master prompt name the source.
- **The brief forgets what I told it**: put it in memory (`memory_write`, with a line in
  `MEMORY.md`) and check that `mcp_endpoint.enabled` is true.
- **"refused: run #N is in progress"**: admin writes wait while any run (previews too) is running,
  so that the nightly backend can't rewrite its own prompt or settings. Retry after `run_get`
  shows it finished.
- **No push on the phone**: `aube_status` shows the subscribed devices; re-enable notifications on
  the Briefs page of that device.
