---
title: Tool Search
sidebar_position: 95
---

# Tool Search

When you have many MCP servers or non-core plugin tools attached to a
session, their JSON schemas can consume a substantial fraction of the
context window on every turn — even when only a few of them are relevant
to what the user actually asked for.

**Tool Search** is Hermes' opt-in progressive-disclosure layer for that
problem. When activated, deferrable tools are replaced in the
model-visible tools array by three bridge tools. Safe deferred tools get a
compact static signature index in `tool_call`, so the model can often call
them directly without loading the full schema first.

:::info Core deferral is opt-in
By default, only MCP tools and non-core tools defer. If you set
`tools.tool_search.defer_core_tools: true`, Hermes may also defer core
tools that are **not** in `always_visible_tools`.

The default bootstrap list is:

- `terminal`
- `process`
- `read_file`
- `write_file`
- `patch`
- `search_files`
- `clarify`

The three bridge tools themselves are always visible.
:::

## How it works

When Tool Search activates for a turn, the model sees three new tools in
place of the deferred ones:

```
tool_search(query, limit?)     — search the deferred-tool catalog
tool_describe(name)            — load the full schema for one tool
tool_call(name, arguments)     — invoke a deferred tool
```

Two additional details matter:

- `tool_call.description` includes a compact manifest of deferred tools
  that are safe to call directly, for example
  `web_search(query: string, limit?: integer[1..100]=5)`.
- Deferred tool names shown in that manifest or returned by `tool_search`
  are **values for `tool_call.name`**. Do not invoke them as native tool
  names.

`tool_search` returns matches with:

- `name`
- `description`
- `signature`
- `describe_required`

That produces two normal paths.

### Direct path for simple tools

```text
Model: tool_search("search the web")
  → {
      matches: [{
        name: "web_search",
        signature: "web_search(query: string, limit?: integer[1..100]=5)",
        describe_required: false
      }]
    }
Model: tool_call("web_search", { query: "Hermes Agent", limit: 5 })
  → { ... }
```

If the needed tool already appears in `tool_call.description` with a clear
signature, the model may skip `tool_search` entirely and call `tool_call`
directly.

### Fallback path for complex tools

```text
Model: tool_search("create a github issue")
  → {
      matches: [{
        name: "mcp_github_create_issue",
        signature: "mcp_github_create_issue(describe first)",
        describe_required: true
      }]
    }
Model: tool_describe("mcp_github_create_issue")
  → { parameters: { type: "object", properties: { ... } } }
Model: tool_call("mcp_github_create_issue", { title: "...", body: "..." })
  → { ok: true, issue_number: 42 }
```

Use `tool_describe` when:

- `describe_required` is `true`
- the compact signature is not enough to infer the arguments safely
- the model needs recovery after an argument-validation failure

When the model invokes `tool_call`, Hermes **unwraps the bridge** and
dispatches the underlying tool exactly as if the model had called it
directly. Pre-tool-call hooks, guardrails, approval prompts, and
post-tool-call hooks all run against the real tool name — not against
`tool_call`. The activity feed in the CLI and gateway also unwraps so you
see the underlying tool, not the bridge.

## When does it activate?

By default Tool Search runs in `auto` mode: it activates only when the
deferrable tool schemas would consume at least 10% of the active model's
context window. Below that, the tools-array assembly is a pure
pass-through and you pay no overhead.

The policy itself is snapped when the session is built. Registry refreshes
reuse that same snapshot; editing `config.yaml` affects only newly-created
sessions.

With that session-static snapshot, the activation decision is still
re-evaluated whenever Hermes rebuilds the tool array from the live
registry, so:

- A session with just a few MCP tools and a long context model never
  activates Tool Search.
- A session with many MCP servers attached (15+ tools typically) starts
  activating it.
- Removing MCP servers mid-session correctly returns to direct exposure
  on the next assembly.

## Configuration

```yaml
tools:
  tool_search:
    enabled: auto       # auto (default), on, or off
    defer_core_tools: false
    always_visible_tools:
      - terminal
      - process
      - read_file
      - write_file
      - patch
      - search_files
      - clarify
    threshold_pct: 10   # percentage of context — only used in auto mode
    search_default_limit: 5
    max_search_limit: 20
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `auto` | `auto` activates above threshold; `on` always activates if there's at least one deferrable tool; `off` disables entirely. |
| `defer_core_tools` | `false` | Allows selected core tools to defer too. Off by default for backward compatibility. |
| `always_visible_tools` | bootstrap list above | Core tools that always stay directly visible even when `defer_core_tools` is enabled. |
| `threshold_pct` | `10` | Percentage of context length at which `auto` mode kicks in. Range 0–100. |
| `search_default_limit` | `5` | Hits returned when the model calls `tool_search` without a `limit`. |
| `max_search_limit` | `20` | Hard upper bound the model can request via `limit`. Range 1–50. |

If you want to guarantee that the full deferred surface collapses even when
it is smaller than the auto threshold, set `enabled: on`.

You can also flip the legacy boolean shape:

```yaml
tools:
  tool_search: true   # equivalent to {enabled: auto}
```

## When NOT to use it

Tool Search trades a fixed per-turn token cost for the bridge-tool
schemas plus the compact manifest in `tool_call.description` against the
savings on the deferred schemas. Cold deferred calls may take zero, one,
or two extra model round trips depending on how much of the argument
shape is already captured in the compact signature.

It's a clear win when you have many tools and use few per turn; it's
overhead when you have few tools total.

The `auto` default handles this for you. If you set `enabled: on`
unconditionally, expect a slight per-turn cost on small toolsets.

## Trade-offs that don't go away

These come from the prompt-cache integrity invariant — they are inherent
to any progressive-disclosure design, not specific to this implementation:

- **One extra round trip on cold tools.** The first time the model needs
  a deferred tool, it may spend one or two extra model calls to find the
  tool and, if needed, load the full schema. Safe compact signatures
  reduce this in the common case, but they do not remove the cold-path
  trade-off entirely. Opting into core deferral increases how often this
  happens.
- **No cache benefit on deferred schemas.** A loaded `tool_describe`
  result enters the conversation history (so it does get cached on
  subsequent turns) but it never benefits from the system-prompt cache
  prefix. The compact manifest does live in the tool payload and is
  therefore part of the stable prefix between registry refreshes.
- **Model-quality dependence.** Tool Search assumes the model can write a
  reasonable search query for the tool it wants. Smaller models do this
  less well; the published Anthropic numbers (49% → 74% on Opus 4 with
  vs. without tool search) show the upside but also that ~26 points of
  accuracy is still retrieval failure.
- **Toolset edits invalidate cache.** Adding or removing a tool mid-
  session changes the bridge tools' descriptions, the compact manifest,
  and the catalog, so the prompt cache is invalidated. This is the same
  trade-off as any toolset edit.
- **Config edits are session-static.** Changing Tool Search config while an
  agent is already alive does not re-shape that session's tool surface.
  Start a new session to pick up the new policy.

## Implementation details

- **Retrieval:** BM25 over tokenized tool name + description + parameter
  names. Falls back to a literal substring match on the tool name when
  BM25 returns no positive-score hits, which protects against
  zero-IDF degenerate cases (e.g. searching `"github"` against a
  catalog where every tool name contains "github").
- **One extractor feeds both surfaces.** The same compact-signature
  extractor is used for the static manifest in `tool_call.description`
  and for `tool_search` hits. If a tool is too complex to render safely,
  Hermes returns `name(describe first)` and sets
  `describe_required: true`.
- **Only safe signatures are indexed statically.** Complex tools are not
  paid for permanently in the manifest. They still remain discoverable via
  `tool_search` and callable via `tool_describe` → `tool_call`.
- **Catalog is stateless across turns.** It rebuilds from the current
  tool-defs list every assembly — no session-keyed `Map`. This avoids
  the class of bug where a stored catalog drifts out of sync with the
  live tool registry.
- **The catalog is scoped to the session's toolsets.** `tool_search`,
  `tool_describe`, and `tool_call` only ever see and invoke tools the
  session was actually granted. A subagent, kanban worker, or gateway
  session restricted to a subset of toolsets cannot use the bridge to
  discover or call a tool outside that subset — the deferred catalog is
  the deferrable slice of the session's own enabled/disabled toolsets,
  not the whole process registry.
- **No JS sandbox.** Hermes uses the simpler "structured tools" mode
  (search / describe / call as plain functions). The JS-sandbox "code
  mode" some other implementations offer is a large surface area; we
  skip it.

## See also

- `tools/tool_search.py` — the implementation
- `tests/tools/test_tool_search.py` — the regression suite
- The `openclaw-tool-search-report` PDF in the original implementation
  PR for the research that shaped the design
