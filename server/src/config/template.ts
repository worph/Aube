/** What a fresh volume gets. Comments survive Settings saves, so they are written once, here. */
export const CONFIG_TEMPLATE = `# Aube configuration. Edited by the Settings page and the admin chat; hand edits are fine —
# comments and key order are preserved on save. Secrets are never written here: use \${VAR}
# references, resolved from the container environment (or data/secrets.env).

timezone: Europe/Paris
run_at: "05:00"        # when the brief is prepared
notify_at: "07:00"     # when the push goes out (or as soon as the brief is ready, if later)
# public_url: https://aube-<you>.nsl.sh   # deep links in push and add-ons

llm:
  base_url: ""                  # any OpenAI-compatible endpoint, e.g. http://claude-code:9091/v1
  api_key: \${LLM_API_KEY}
  model: ""
  tool_mode: backend            # backend: the LLM uses its own tools | aube: Aube runs the tool loop
  timeout_s: 1800
  extra_body: {}                # passed through untouched
  tool_connections: []          # tool_mode aube only
  max_tool_rounds: 30

connections: {}
#  beacon:
#    transport: http
#    url: http://beacon:9300/mcp/
#    via: beacon

mcp_endpoint:
  enabled: false                # Aube's own MCP endpoint (memory + briefs) at /mcp
  token: \${AUBE_MCP_TOKEN}

memory:
  max_file_kb: 256
  max_image_kb: 2048
  max_total_mb: 50

retention:
  artifact_days: 30

addons: []
`

export const MASTER_PROMPT_TEMPLATE = `Organise my day. Keep it readable in under two minutes.

1. Infra first: anything down or flapping overnight.
2. My calendar for today, and tomorrow morning if it starts early. Flag conflicts.
3. Mail since yesterday: only what needs an action from me.
4. My open tasks by urgency (overdue, due today, urgent, due this week).
5. Sport and meals if I have tools for them.
6. End with a time-blocked plan of the day around my events.
`

export const MEMORY_INDEX_TEMPLATE = `# Memory

Context that no connected tool knows and that should shape future briefs.
Rule: if a tool has a status for it (task, event, mail, monitor), ask the tool — memory holds
context, never status. One line per file below: \`- [Title](path.md) — what it holds\`.
`
