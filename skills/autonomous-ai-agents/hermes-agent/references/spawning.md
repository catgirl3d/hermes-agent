# Spawning Additional Hermes Instances

Run additional Hermes processes as fully independent subprocesses with separate
sessions, tools, and environments.

## When to Use This vs `delegate_task`

| | `delegate_task` | Spawning `hermes` process |
|---|---|---|
| Isolation | Separate conversation, shared process | Fully independent process |
| Duration | Minutes | Hours or days |
| Tool access | Subset of parent's tools | Full tool access |
| Interactive | No | Yes, with PTY |
| Use case | Quick parallel subtasks | Long autonomous missions |

## Delegating Subtasks

Use `delegate_task(goal=...)` for a focused, short-lived subtask. To run
several independent subtasks in parallel, pass `tasks=[...]`; concurrency is
limited by `delegation.max_concurrent_children` (default: 3).

`background=true` returns immediately, but the work remains tied to the parent
process. Do not use it for work that must survive a restart; use `cronjob` or
`terminal(background=true, notify_on_complete=true)` instead.

Delegated agents use the `leaf` role by default and cannot delegate again.
`orchestrator` agents can delegate only when `delegation.orchestrator_enabled`
is enabled and `delegation.max_spawn_depth` permits it. Configure behavior
under `delegation.*`, including `max_iterations`, provider/model overrides,
and concurrency limits.

## One-Shot Mode

```text
terminal(command="hermes chat -q 'Research GRPO papers and write summary to ~/research/grpo.md'", timeout=300)

terminal(command="hermes chat -q 'Set up CI/CD for ~/myapp'", background=true, notify_on_complete=true)
```

## Interactive PTY Mode via tmux

Hermes uses `prompt_toolkit`, so interactive spawning needs a real terminal.
Use tmux.

```text
# Start
terminal(command="tmux new-session -d -s agent1 -x 120 -y 40 'hermes'", timeout=10)

# Wait for startup, then send a message
terminal(command="sleep 8 && tmux send-keys -t agent1 'Build a FastAPI auth service' Enter", timeout=15)

# Read output
terminal(command="sleep 20 && tmux capture-pane -t agent1 -p", timeout=5)

# Send follow-up
terminal(command="tmux send-keys -t agent1 'Add rate limiting middleware' Enter", timeout=5)

# Exit
terminal(command="tmux send-keys -t agent1 '/exit' Enter && sleep 2 && tmux kill-session -t agent1", timeout=10)
```

## Multi-Agent Coordination

```text
# Agent A: backend
terminal(command="tmux new-session -d -s backend -x 120 -y 40 'hermes -w'", timeout=10)
terminal(command="sleep 8 && tmux send-keys -t backend 'Build REST API for user management' Enter", timeout=15)

# Agent B: frontend
terminal(command="tmux new-session -d -s frontend -x 120 -y 40 'hermes -w'", timeout=10)
terminal(command="sleep 8 && tmux send-keys -t frontend 'Build React dashboard for user management' Enter", timeout=15)
```

Relay context between sessions by capturing one pane and sending the needed
facts into the other.

## Session Resume

```text
terminal(command="tmux new-session -d -s resumed 'hermes --continue'", timeout=10)

terminal(command="tmux new-session -d -s resumed 'hermes --resume 20260225_143052_a1b2c3'", timeout=10)
```

## Tips

- Prefer `delegate_task` for quick subtasks.
- Use `-w` when spawned agents edit code.
- Set timeouts for one-shot mode.
- Use `hermes chat -q` for fire-and-forget.
- Use tmux for interactive sessions.
- For scheduled work, prefer the `cronjob` tool or `hermes cron` over raw spawning.
