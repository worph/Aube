# Aube: Architecture

This document is the model: concepts, the nightly run, the day band, memory, the tool question,
the chat, and the rules that must not break. How we build it is in
[`IMPLEMENTATION.md`](./IMPLEMENTATION.md).

---

## 1. The one-sentence model

**Once a night Aube sends an LLM the master prompt, the date and the memory, and stores what it
answers as the day's brief and day band. The LLM gathers everything with the tools it can reach,
and Aube only owns the prompt, the memory, the clock and the archive.**

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **master prompt** | Your description of the brief, in prose. One document, versioned |
| **backend** | Whatever answers Aube's OpenAI-compatible `/v1/chat/completions` calls. In our deployment, the `claude-code` container's API. Aube makes no assumption beyond the protocol |
| **tool mode** | Who runs tools for the backend: `backend` (it has its own MCP tools and loop, e.g. `claude-code`) or `aube` (a plain model; Aube runs the loop through function calling) |
| **memory** | A persistent folder (`data/memory/`) of markdown files and images, with `MEMORY.md` as its index |
| **Aube tools** | Aube's own small toolset: memory, past briefs, and (for the chat) settings and the master prompt |
| **run** | One execution for one **date**: prompt → backend → brief. It has a status and a log |
| **brief** | The stored result of a run: a title, a one-line headline for the notification, a markdown body, the day's events and the proposed plan blocks |
| **day band** | The 00:00–24:00 timeline shown beside a brief, with two lanes: **events** (what is fixed) and **plan** (what the brief proposes) |
| **block** | One slot of the proposed plan (deep work, sport, lunch, travel…), drawn in the plan lane |
| **add-on** | An optional notification channel reached through an MCP tool (e.g. `telegram-mcp__send_message`) |

## 3. The nightly run

```
run_at ──▶ assemble prompt ──▶ backend ──▶ validate ──▶ store brief ──▶ (wait) ──▶ notify_at: push + add-ons
            master prompt        works with      JSON contract,    + events
            date, timezone       its tools +     1 retry, else
            memory index         Aube's tools    keep raw text
            answer contract
```

**Two times, one each.** `run_at` (default 05:00) leaves room for a slow backend. `notify_at`
(default 07:00) is when the phone buzzes, the same every day. If the brief is ready after
`notify_at`, the notification goes out as soon as it is. What changes from day to day (sport on
Monday, fish on Friday, a lighter brief on Sunday) goes in the master prompt, which receives the
weekday.

**What the backend receives** (a `system` message and a `user` message):

```
[system]    You prepare one person's morning brief. Use the tools you can reach.
            Source tools (calendar, Trello, …) are the truth for their own state;
            memory holds context, never status.
            Aube tools: aube__memory_*, aube__brief_*.
            The answer contract.
[user]      date: 2026-11-04, Wednesday, Europe/Paris, now 05:00
            MEMORY.md (inline)
            last 3 briefs: date + headline
            the master prompt, verbatim
```

**The answer contract.** One JSON object:

```json
{
  "title": "☀️ Mercredi 4 novembre",
  "headline": "1 monitor down · 3 meetings · legs at 18:30 · fish tonight",
  "brief_markdown": "…",
  "events": [
    { "start": "10:00", "end": "11:00", "title": "Sprint review", "location": "Meet", "source": "calendar" },
    { "start": "14:30", "end": "15:30", "title": "Dentist", "source": "calendar" },
    { "all_day": true, "title": "Paul's birthday", "source": "calendar" }
  ],
  "blocks": [
    { "start": "08:30", "end": "10:00", "title": "Deep work: invoice export", "kind": "focus" },
    { "start": "11:00", "end": "12:30", "title": "Mail + contract reply", "kind": "task" },
    { "start": "12:30", "end": "13:15", "title": "Lunch: lentil salad", "kind": "meal" },
    { "start": "14:10", "end": "14:30", "title": "Leave for the dentist", "kind": "travel" },
    { "start": "18:30", "end": "19:20", "title": "Legs (wger PPL, day 3)", "kind": "sport" }
  ],
  "sources": [{ "name": "gmail", "ok": true }, { "name": "uptime", "ok": false, "note": "timeout" }],
  "memory_notes": "optional: what was written to memory this run, in one line"
}
```

**Validation is layered, so one bad part doesn't sink the rest:**

1. `title`, `headline` (≤ 140 chars) and `brief_markdown` are required. If one fails, Aube retries
   **once** with the validation error appended. If that fails too, Aube keeps the backend's raw
   text as the brief, with a generic title and a banner saying it isn't in the expected shape.
2. `events` and `blocks` are validated **per item**. An invalid item is dropped and counted ("2
   items could not be placed"). It never triggers a retry or loses the brief. If either list is
   missing, its lane shows "nothing reported".

**Fail-soft.**

- A source the backend can't reach is the backend's to report (`sources[]`, plus a line in the
  brief). The master prompt can say how to handle it.
- If the backend itself fails (auth, unreachable, error, still busy at the deadline), Aube stores a
  **failure brief** that says what broke, and still notifies. Silence in the morning is never the
  outcome.

### Run states

```
PENDING → RUNNING → READY → NOTIFIED
              └──▶ FAILED  (a failure brief is stored and notified)
```

**Run now** and **Preview** start the same run by hand. A Preview is stored but neither notifies
nor replaces the day's brief. A second real run for the same date replaces the day's brief. The
earlier one stays in the run log.

## 4. The day band

The goal is to **see the shape of the day at a glance**: what is fixed, what is proposed, and where
the gaps are. The band is a vertical timeline from **00:00 to 24:00**, shown beside the brief
(above it on a phone), with two lanes side by side on the same time scale:

- **Events** (solid): what is fixed, usually from the calendar.
- **Plan** (lighter, tinted by kind): the time-blocked plan the brief proposes around the events.

```
 ┌──────────── Mercredi 4 novembre · as of 05:00 ──────────────────────────────┐
 │ all day: Paul's birthday                                                    │
 │       EVENTS            PLAN                ☀️ Mercredi 4 novembre            │
 │ 08 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  ░ Deep work:          🚨 api.example.com down since …    │
 │ 09                  ░ invoice export     📅 Today …                         │
 │ 10 ┃ Sprint review                       ✅ Tasks …                         │
 │ 11 ┃                ░ Mail + contract    🏋️ Legs, 18:30 …                   │
 │ 12                  ░ Lunch              🍽️ Fish: cod with lentils …        │
 │ 13                                                                          │
 │ 14 ┄┄┄┄ now ┄┄┄┄┄┄  ░ Leave (travel)                                         │
 │ 14 ┃ Dentist                                                                 │
 │ …                                                                           │
 │ 18                  ░ Legs                                                  │
 │ 24 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄                                                           │
 └────────────────────────────────────────────────────────────────────────────┘
```

- **Placement**: each item is positioned on the 24h scale by start and end. Items that overlap
  *within a lane* are laid out side by side (columns), the way calendar apps do it. An item
  without an `end` gets a default length (30 min) and a dashed bottom edge.
- **Free time is visible** as empty space in both lanes. A plan block that overlaps an event is
  allowed (e.g. "prep" during a long call), but it is outlined so the clash shows.
- **All-day events** sit in a row above the band.
- **Items crossing midnight** are clipped to the band, with a marker showing they continue.
- **A now-line** crosses both lanes when the brief being viewed is today's. The band scrolls to
  it on open, and otherwise to the first item.
- **Plan kinds** (`focus`, `task`, `meeting-prep`, `sport`, `meal`, `travel`, `break`, `other`)
  only pick a tint and an icon. Any other value is shown as `other`.
- Times are local, in the configured timezone, as `HH:MM` for the brief's date.

**This is not a copy of the calendar, and the plan isn't a schedule Aube enforces.** Both lanes
are part of the brief: a snapshot of what the backend saw and proposed at `run_at`, archived with
that day's text, exactly like the sentences in the brief itself. Aube never updates them, never
syncs them, and never writes them anywhere. The band is labelled "as of 05:00". This keeps
invariant 1.

The backend fills `events` from whatever it reads (calendar, a mail with a meeting invite,
anything the master prompt asks for). `blocks` is its proposed plan, shaped by the master prompt
("deep work in the morning", "sport at 12:30 or 18:30"). The `source` field on events is a free
label, shown as a colour or tag. Aube only places what it is given.

## 5. Memory

### 5.1 What it is for

The memory is the **backend's workspace and Aube's long-term context**: things that no connected
tool knows and that should shape future briefs.

| Belongs in memory | Does **not** belong in memory |
|---|---|
| "Knee injury since 28 Oct, no running until 20 Nov" | "Card *Fix invoice export* is done" (it's Trello's) |
| "Fish on Fridays: we had cod last week, vary it" | "Meeting with Marc moved to 15:00" (it's the calendar's) |
| A photo of the gym's new timetable | "Monitor api.example.com is down" (it's Uptime Robot's) |
| "Client X: always reply within the day" | A copy of yesterday's task list (the brief archive already has it) |
| Notes the user dictated in the chat | |

The rule: **if a tool has a status for it, ask the tool. Memory holds context, never status.**
This is stated in the run prompt and the chat prompt, and repeated in `MEMORY.md`'s header.

### 5.2 Shape

```
data/memory/
├── MEMORY.md            # the index: one line per file, always inlined in the run prompt
├── health.md
├── food.md
├── clients/
│   └── client-x.md
└── images/
    └── gym-timetable-2026-11.jpg
```

- Markdown and images only (`.md`, `.png`, `.jpg`, `.webp`, `.gif`). There is a size cap per
  file and in total.
- **Scope**: everything goes through Aube's memory tools and stays inside this folder. Paths are
  normalised, and `..` and symlinks are refused.
- **Who does what**: the nightly run and the chat both have **full access**: list, read, write,
  delete and restore.
- **History**: every write and delete is journaled (path, before/after, who: `run:<id>` or
  `chat:<thread>`). Nothing is lost: a deleted file can be restored from the memory panel's
  history or from the chat. A run's memory changes are listed in its run log.

### 5.3 How the backend reaches it

Through **Aube's MCP endpoint** (§6): `memory_list`, `memory_read`, `memory_write`,
`memory_delete`, `memory_history`, `memory_restore`, plus `brief_list` / `brief_get` for the
archive.

- In **`backend` tool mode** (e.g. `claude-code`), the backend reaches the endpoint through its
  own MCP config. In our deployment that is Beacon, where a beaconify sidecar announces Aube as
  `aube`. Image reads return MCP image blocks, so the backend sees the images even though the
  OpenAI-compatible API itself carries only text.
- In **`aube` tool mode**, Aube runs the same tools in-process.

### 5.4 The memory panel

A read-only view on the Chat page (collapsible on the side, a tab on a phone):

- the file tree, with `MEMORY.md` pinned first;
- a markdown preview of a file, or the image;
- its history (who changed it, when, from which run or chat thread), with a diff for text, and
  **Restore** for any version, including deleted files;
- a "changed last night" marker on files the latest run touched.

Editing is done through the chat ("move the knee note to health.md", "forget the old gym
timetable"). The panel shows the result live. Restore is the one write the panel does directly,
because undoing must not depend on a working LLM.

## 6. Tools: who owns what

### 6.1 The two places a tool can live

| | **Tools configured in the LLM backend** | **Tools configured in Aube** |
|---|---|---|
| Example | Gmail and calendar connectors and Beacon, all in `claude-code`'s MCP config | An MCP URL entered in Aube's Settings |
| Who runs the tool loop | the backend | Aube (function calling) |
| Works with | agent backends (`claude-code` API, any agent behind an OpenAI-compatible façade) | any model with tool calling (OpenAI, Mistral, Ollama, vLLM, LiteLLM, …) |
| Credentials | already in the backend | in the MCP servers; Aube holds a URL |
| Visibility for Aube | only what the backend reports | every call, arguments and result |

### 6.2 What Touchstone and Newsdesk already settled

- **The app's own tools are defined once** and served by every surface (chat, MCP endpoint).
  There is "no second definition of what an agent may ask this app".
- **The admin chat is an app-owned loop**: the model answers one JSON object naming at most one
  tool, the app runs it, and the result becomes a row before the next round. It needs only text
  in and text out, so it works with any backend.
- **The agent brings its own tools**, and the app doesn't list or restrict them.

### 6.3 Decision: one protocol, one toolset, two tool modes

```
                       ┌──────────────── Aube toolset (defined once) ────────────────┐
                       │ memory_*  brief_*      (+ chat only: settings_*, prompt_*,   │
                       │                           connection_test, beacon_discover)  │
                       └────────┬─────────────────────┬────────────────┬─────────────┘
                                │                     │                │
                      MCP endpoint /mcp         admin chat loop   function-calling loop
                      (beaconified as `aube`)   (Aube-owned)      (Aube-owned)
                                │                                      │
   tool mode `backend`:  backend ── its own MCP tools (Gmail, Beacon…)  │
                                 └─ aube__memory_*, aube__brief_* ──────┘ (via Beacon)
   tool mode `aube`:     plain model ── Aube toolset + MCP connections listed in Settings
```

- **One protocol: OpenAI-compatible `/v1/chat/completions`.** It is the lowest common denominator,
  and `claude-code` already speaks it, as do LiteLLM, Ollama, vLLM, OpenRouter, Mistral and
  OpenAI. Anthropic's own API can come later as a second adapter if needed. It isn't needed for
  the design.
- **Tool mode `backend` (default, M1).** Aube sends no `tools` field. The backend uses what it is
  connected to. Aube's toolset reaches it through the MCP endpoint, if the backend has that in
  its own config.
- **Tool mode `aube` (M6).** Aube sends `tools` (its run toolset plus the tools of the MCP
  connections listed in Settings) and runs the loop. Claude.ai connectors aren't reachable this
  way. That is a limit of plain models, and Settings says so.
- **Nothing is tailored to `claude-code`.** Aube doesn't configure the backend and doesn't
  depend on its specifics (§11). Aube's only extension point is a generic `extra_body`, empty by
  default, passed through untouched for backends that read extra fields.
- **If the backend can't reach Aube's endpoint**, the run still works: `MEMORY.md` is inline, and
  the run log notes that memory was read-only for that run.

### 6.4 The run toolset and the chat toolset

The nightly run gets **memory (everything) and briefs**. It can't change settings or the master
prompt. The chat gets everything. Aube's MCP endpoint serves only the run toolset, so anyone who
can see Aube on Beacon can at most touch memory (which is journaled and restorable) and read
briefs.

## 7. The administrator chat

The Touchstone / Newsdesk shape: **Aube owns the loop and the tools, and the model only chooses the
next tool.** Each round the model answers `{ "say": "...", "call": { "tool": "...", "args": {} } | null }`.
Aube runs the call, appends the result as a row, and asks again. A turn is bounded at 8 tool calls
and 120 s, and tool results are cut to 4 000 characters in the prompt (the row keeps the full
text). It uses the same backend as the run, in text mode, so it works whatever the backend is.

Uses:

1. **Connecting things**: discover Beacons and their servers, test the LLM endpoint, test a
   direct MCP URL, and explain what's missing ("no backend configured, nothing can run").
   `backend_ask` sends one plain question to the backend ("which MCP tools can you use?") to check
   what it is connected to. That answer is the backend's own description, not a guarantee.
2. **Writing the master prompt**: draft it from a conversation, show a diff, save a new version
   only after you confirm, run a Preview.
3. **Editing memory**: everything the run can do, and the panel shows the result.

**Bootstrap.** The chat needs a model, so the first step is the Settings page with no inference
(Newsdesk's "bootstrap paradox"). You enter the endpoint URL and token, press **Test**, and from
then on the chat can do the rest.

**Writes need a confirmation round-trip** (Newsdesk's `confirmWith`) for settings, the master
prompt and memory deletes: the tool is *proposed* with a summary or a diff, and runs after you
confirm in the chat. Memory writes run directly and are journaled.

Threads are append-only. "New conversation" starts a new thread and keeps the old one.

## 8. Notifications

- **In-app is the default and is always on.** Web push (VAPID, the installed PWA) sends `title` +
  `headline` at `notify_at`, with a deep link to that day's brief.
- **Add-ons** are MCP tool calls configured in Settings, e.g.
  `{ tool: "telegram-mcp__send_message", args: { text: "{{headline}}\n{{url}}" } }`. An add-on
  sends the headline + link, or the full markdown rendered for the channel. Add-ons only send;
  nothing comes back. The day band is in-app only.
- A failed add-on or push is logged in the run and shown on the Briefs page. It never changes the
  brief.

## 9. Invariants

1. **No second copy of state.** Aube never keeps or updates a task's, event's or mail's status.
   Memory holds context, the archive (text and day band) holds what was said on a given day as of
   `run_at`, and the source tools hold the truth.
2. **Aube doesn't restrict the backend.** Tools connected to the backend are used as connected.
   Aube's only limit is on its *own* tools: the run toolset can't change settings or the master
   prompt.
3. **A brief is always stored and notified**, even if it is a raw-text brief or a failure brief.
   Bad `events` or `blocks` cost items on the band, never the brief.
4. **Memory stays in its folder, and nothing in it is ever lost.** Every write and delete goes
   through Aube's tools, stays inside `data/memory/`, and is journaled with who made it.
   Everything can be restored.
5. **One definition per tool.** The chat, the MCP endpoint and the function-calling loop use the
   same registry.
6. **Protocol-agnostic.** Aube speaks OpenAI-compatible chat completions and MCP, and nothing
   specific to one backend.
7. **Every run is inspectable**: the messages sent, the raw answer, the parsed brief and events,
   the memory changes, usage, duration and failure class are stored with the run.
8. **The app works with every port down.** Settings, the Briefs page and the memory panel render
   when the backend, Beacon and push are all unreachable.
9. **Access control belongs to AppShield.** Aube has no login. The MCP endpoint is reached only by
   the beaconify sidecar, with a bearer token.

## 10. What lives outside, and where

| Concern | Lives in |
|---|---|
| Gmail, calendar | the backend's MCP config (claude.ai connectors in our deployment) |
| Trello, Uptime Robot, Mealie, wger | MCP servers behind Beacon |
| LLM account, model choice, the backend's tool permissions and limits | the backend. Aube uses it as it is and never configures it |
| Login, sessions | AppShield (password or OIDC) |
| Announcing Aube to Beacon | a beaconify sidecar |
| Telegram / Discord / ntfy add-ons | their MCP servers |
| Scheduling Aube's runs | Aube (its own clock) |

## 11. Deployment shape

Three services in one compose file: **AppShield** (published, the only way in) → **aube** (UI, API,
scheduler, MCP endpoint; one SQLite file plus `data/memory/` and `data/master-prompt.md` on a
volume) and **beaconify** (announces `aube` on the `pcs` network that Beacon probes). It is
packaged for the Yundera AppStore with an `x-casaos` block. Push and the PWA need the box's HTTPS
subdomain.

Aube runs on the user's own box as a personal assistant. **The backend is out of Aube's scope.**
Aube assumes an OpenAI-compatible endpoint that is already up, logged in and allowed to use its
tools, and Aube never changes its configuration. Its limits (request timeout, concurrency, tool
permissions) are the backend's own business. Aube only reacts to what comes back: a timeout or an
error is a failure class (IMPLEMENTATION §8), and the run degrades to a failure brief.

## 12. Open questions

None blocking. Aube's own run timeout is 30 min. Anything the backend imposes below that shows up
as a failure brief that says so.
