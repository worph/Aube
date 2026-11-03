# CLAUDE.md — Aube

Self-hosted nightly planner. The spec is `README.md`, `docs/ARCHITECTURE.md` (the model, the
invariants) and `docs/IMPLEMENTATION.md` (how). When code and docs disagree, the architecture wins;
fix the code or update the doc in the same change.

## Commands (run from this directory, never from /d/workspace)

```bash
npm install                 # workspaces: shared, server, web
npm run typecheck           # tsc --build (shared, server) + web noEmit
npm test                    # vitest: shared/test, server/test
npm run build               # shared -> web (into server/public) -> server
npm run dev                 # tsx watch server (:8080) + vite (:5173, proxies /api)
npm run db:generate         # after editing server/src/db/schema.ts: new append-only migration
docker build -f deploy/Dockerfile -t aube:dev .
```

Dev data lives in `./data` (gitignored) unless `AUBE_DATA_DIR` is set.

## Layout

- `shared/src` — zod schemas and pure logic shared with the web: config, answer contract, day band layout.
- `server/src` — Fastify app. `config/` (YAML store, `${VAR}`), `db/` (drizzle), `llm/` (OpenAI-compatible
  client), `mcp/` (client, Beacon discovery, Aube's endpoint), `run/` (nightly run), `memory/`, `tools/`
  (one registry for chat, MCP endpoint and tool loop), `chat/`, `notify/`, `scheduler.ts`, `routes/`.
- `web/src` — React SPA: Chat (+ memory panel), Master prompt, Briefs (+ day band), Settings.
- `Apps/Aube/` — Yundera store listing (AppShield + aube + beaconify).

## Rules that must hold (ARCHITECTURE §9)

1. No second copy of tool state. Memory is context; brief text, events and blocks are an archived snapshot.
2. Aube never restricts or configures the LLM backend. Nothing backend-specific in code; only the
   OpenAI-compatible protocol and MCP.
3. A brief is always stored and notified (contract → raw → failure). Bad events/blocks drop items, never the brief.
4. Memory writes only through `memory/store.ts`: inside `data/memory/`, journaled, restorable.
5. One definition per tool (`tools/registry.ts`); the MCP endpoint serves `run` scope only.
6. Secrets only as `${VAR}` in config.yaml; never returned to the browser.
7. Settings, Briefs and the memory panel render with every port down.
8. No login in Aube: AppShield owns access.

Migrations are append-only: never edit a generated file under `server/drizzle/`.
