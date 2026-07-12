# Hermes Kanban

Use this file for Hermes's durable multi-agent work queue backed by SQLite.
Kanban is for shared boards, worker assignment, and dispatcher-managed task
execution across profiles.

## Common CLI Verbs

```text
hermes kanban init
hermes kanban create
hermes kanban list
hermes kanban show
hermes kanban assign
hermes kanban link
hermes kanban unlink
hermes kanban comment
hermes kanban complete
hermes kanban block
hermes kanban unblock
hermes kanban archive
hermes kanban tail
```

Other verbs exist for watch, stats, runs, log, dispatch, daemon, and gc.

## Worker Tooling

Dispatcher-spawned workers see a focused `kanban_*` toolset such as:

- `kanban_show`
- `kanban_complete`
- `kanban_block`
- `kanban_heartbeat`
- `kanban_comment`
- `kanban_create`
- `kanban_link`

Profiles that explicitly enable the broader `kanban` toolset may also get
`kanban_list` and `kanban_unblock`.

## Dispatcher Model

- The dispatcher usually runs inside the gateway.
- It reclaims stale claims, promotes ready tasks, claims work atomically, and spawns assigned profiles.
- Tasks auto-block after repeated failures (`failure_limit`, default 2).

## Isolation Model

- Board is the hard boundary. Workers get `HERMES_KANBAN_BOARD` pinned in env.
- Tenant is a soft namespace within a board for workspace-path and memory-key isolation.

## Verification

- User docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban
- CLI wiring: `hermes_cli/kanban.py`
- Tooling: `tools/kanban_tools.py`
