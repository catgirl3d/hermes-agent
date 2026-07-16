# Hermes Cron Jobs

Use this file for scheduled tasks, recurring automations, and jobs that must
outlive the current conversation or process.

## Common CLI Commands

```text
hermes cron list            List jobs (--all for disabled)
hermes cron create SCHED    Create: '30m', 'every 2h', '0 9 * * *'
hermes cron edit ID         Edit schedule, prompt, delivery
hermes cron pause ID        Pause a job
hermes cron resume ID       Resume a paused job
hermes cron run ID          Trigger on next tick
hermes cron remove ID       Delete a job
hermes cron status          Scheduler status
```

Slash shortcut: `/cron` in interactive sessions.

## Schedule Formats

- Duration: `30m`, `2h`, `1d`
- Every-phrase: `every 2h`, `every monday 9am`
- Five-field cron: `0 9 * * *`
- ISO timestamp for one-shot jobs

## Per-Job Knobs

- `skills`
- `model` / `provider` override
- `script` for pre-run data collection
- `no_agent=True` when the script should be the whole job
- `context_from` to chain one job's output into another
- `workdir` so Hermes runs in a specific project with its `AGENTS.md` or `CLAUDE.md`
- Multi-platform delivery

## Runtime Invariants

- Three-minute hard interrupt per cron run
- `.tick.lock` prevents duplicate scheduler ticks across processes
- Cron sessions pass `skip_memory=True` by default
- Deliveries are framed with header and footer markers instead of being mirrored into an existing gateway conversation

## When to Prefer Cron

Prefer cron over `delegate_task(background=true)` or a long-running spawned
Hermes process when the work must survive process restarts and run on a fixed
schedule.

## Verification

- User docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/cron
- Source files: `cron/jobs.py` and `cron/scheduler.py`
