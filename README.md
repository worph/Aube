# Aube

**A self-hosted morning brief.** Once a night, Aube hands an LLM agent your **master prompt**
("organise my day, sport on Monday and Wednesday, fish on Friday, check my calendar, mail, Trello
and monitors…") together with Aube's **memory**. The agent does the work with the tools it is
already connected to (Gmail, calendar, Trello, Uptime Robot, Mealie, wger, …). In the morning, one
brief is waiting in the app and a push notification tells you so.

> *Aube* is French for "dawn": the brief is ready at first light.

> Status: **v1.1.0** (evening preview with a wake-up time), image `ghcr.io/worph/aube:1.1.0` (amd64 + arm64). The model is in
> [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), the build notes in
> [`docs/IMPLEMENTATION.md`](./docs/IMPLEMENTATION.md), and the commands in [`CLAUDE.md`](./CLAUDE.md).

---

## What it is

Aube is a small app that owns four things and nothing else:

1. **The master prompt**: what you want in the brief, in your own words.
2. **The memory**: a persistent folder of markdown files and images that Aube and its agent can
   read and write. It holds context that no other tool has.
3. **The clock**: when the brief is prepared and when you are notified.
4. **The archive**: one brief per day, readable in the app beside a **day band**: a 00:00–24:00
   timeline with the day's events and, in a lighter lane next to them, the proposed plan. A web
   push tells you when it's ready.

Everything else belongs to the tools you already use. **Aube doesn't copy their state.** A task's
status lives in Trello, an event in your calendar, a mail in Gmail. Each night the agent asks them
again. There is never a second place where a task is "done".

```
  run_at (05:00)                                                     notify_at (07:00)
       │                                                                   │
       ▼                                                                   ▼
  master prompt ─┐                                                    web push
  memory index  ─┼──▶  LLM over an OpenAI-compatible API  ──▶  brief  ──▶  "☀️ Tuesday 4 Nov"
  today's date  ─┘        │          ▲                       + day band   + optional MCP add-ons
                          │          │                         stored       (telegram-mcp, …)
                          ▼          │
                  Gmail · calendar · Beacon (Trello, Uptime Robot, Mealie, wger, …)
                  and Aube's own MCP tools (memory, past briefs)
```

The brief is **plain information**. You read it, and that's all. There are no buttons on it and
you don't reply to it. If you want to change what tomorrow's brief says, change the master prompt
or tell the administrator chat.

## The four pages

| Page | What it's for |
|---|---|
| **Chat** | An administrator chat (like Touchstone's and Newsdesk's). It helps you connect MCP servers and the LLM, write and refine the master prompt, and read or edit the memory. A **memory panel** beside it shows the files, images and their history |
| **Master prompt** | The editor for what goes into the brief, with version history and a **Preview** that runs it now without notifying anyone |
| **Briefs** | One brief per day, newest first, each shown beside its **day band** (00:00–24:00: calendar events, and the proposed plan in a lighter lane), with the recommended wake-up time when there is one. Also the web-notification settings for this device and the run log of each night |
| **Settings** | LLM connection, Beacon discovery, extra MCP connections, Aube's own MCP endpoints (memory, admin), schedule, notification add-ons |

## A master prompt

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

**Evening preview (optional).** Set **Settings → Schedule → Evening preview at** (e.g. 21:00) and
Aube also prepares tomorrow's brief the evening before, with a recommended **wake-up time**, and
notifies you right away so you can set your alarm. The morning run still refreshes the brief
(unless you turn it off).

## Where the tools live

Aube talks to **any OpenAI-compatible endpoint** and doesn't care what is behind it. On my box
that is the `claude-code` container's `/v1/chat/completions` API, used as it is. Aube neither
configures it nor depends on anything specific to it.

Aube doesn't decide what the LLM may do. **If MCP servers are connected to the LLM backend, it uses
them as connected, with all their capabilities.** That covers the Gmail and calendar connectors and
everything behind Beacon. Aube adds its own small toolset (memory, past briefs) on top. For a plain
model with no tools of its own, Aube runs the tool loop itself. See
[ARCHITECTURE §6](./docs/ARCHITECTURE.md#6-tools-who-owns-what).

| Credential | Where it lives |
|---|---|
| Gmail / calendar | the LLM backend's own MCP config (claude.ai connectors in our deployment) |
| Trello / Uptime Robot / Mealie / wger | their MCP servers, behind Beacon |
| LLM | the backend's bearer token in Aube's `.env` (for `claude-code`: its `AUTH_PASSWORD`) |
| Telegram and other add-ons | their MCP servers |
| Access to the app | [AppShield](../AppShield) in front of Aube. Aube has no login of its own |

## Installing

Aube runs inside a Yundera box like any store app: the Aube container with its data folder, an
AppShield gate as the only public surface, and a beaconify sidecar that announces Aube's memory
tools to the box's Beacon. The listing is `Apps/Aube/` (also usable on its own: this repo is a
one-app store). HTTPS (the box's `nsl.sh` subdomain) is required for the PWA and web push.

The LLM is **another app**, not part of Aube's stack. On a Yundera box that is the Claude Code
app with its OpenAI-compatible API turned on (`OPENAI_API_ENABLED=true`), reachable from Aube on
the shared network; its bearer is the Claude Code app's password. Aube only needs a base URL.

Then, in Aube:

1. **Settings → LLM**: the base URL of the OpenAI-compatible endpoint, a model, **Test**.
2. **Settings → Secrets**: the endpoint's bearer as `LLM_API_KEY`. Write-only: it is stored in
   `data/secrets.env` and never shown again. (A value in the container environment wins.)
3. **Settings → Aube MCP endpoint**: enable it so the nightly LLM can write memory (the backend
   must reach `aube__memory_*` through its own Beacon connection).
4. **Master prompt**: write what you want, **Preview**.
   Or from Claude: enable **Settings → Admin MCP endpoint** and the `aube-admin` server appears
   on Beacon with everything the chat can do (`aube-admin__prompt_get`, `…__prompt_save`,
   `…__settings_save`, `…__run_preview` / `…__run_get`, …). Its writes wait while a run is in progress.
5. **Briefs**: turn on notifications on your phone (install the app first on iOS).

### Releasing

Bump the version in the four `package.json` files, `Apps/Aube/docker-compose.yml` (image and
`x-compose-app.version`) and this README, commit, then tag `vX.Y.Z` and push both. The GitHub
workflow (`.github/workflows/docker-publish.yml`) gates on typecheck and tests, then pushes
`ghcr.io/worph/aube:X.Y.Z` for amd64 and arm64; `main` builds `latest`.

## Developing

```bash
npm install && npm run dev      # server on :8080, web on :5173 (proxies /api)
npm test && npm run typecheck
```

Data goes to `./data` (or `AUBE_DATA_DIR`). See [`CLAUDE.md`](./CLAUDE.md).

## Roadmap

| Milestone | Contents |
|---|---|
| **M0** | Container, AppShield, SQLite, Settings (LLM + Beacon discovery with **Test** buttons) |
| **M1** | Master prompt page → scheduled run through an OpenAI-compatible backend with its own tools → Briefs page with the day band |
| **M2** | Memory folder + Aube's MCP endpoint (memory and briefs tools), beaconified for the backend |
| **M3** | Administrator chat (Aube-owned loop, Aube's tools) + memory panel |
| **M4** | PWA + web push at `notify_at`; run log and usage |
| **M5** | MCP notification add-ons (`telegram-mcp` first) |
| **M6** | Plain models: Aube runs the tool loop (function calling) over its toolset and MCP connections |

Details in [`docs/IMPLEMENTATION.md`](./docs/IMPLEMENTATION.md).

## What it is not

- Not a task manager, a calendar or a mail client. It never holds a second copy of their state.
- Not interactive. The brief is information to read. Everything you configure goes through the
  chat or the master prompt.
- Not a gatekeeper. It doesn't restrict the tools the LLM is connected to.
- Not multi-user. One person, one master prompt, one brief a day.

## License

TBD.
