# Hermes Curator

Use this file for Hermes's background skill-lifecycle system that tracks usage,
marks stale skills, archives them safely, and supports optional consolidation.

## Commands

```text
hermes curator status
hermes curator run
hermes curator pause
hermes curator resume
hermes curator pin
hermes curator unpin
hermes curator archive
hermes curator restore
hermes curator prune
hermes curator backup
hermes curator rollback
```

Slash shortcut: `/curator <subcommand>`.

## Scope and Guarantees

- Curator only touches skills with `created_by: "agent"` provenance.
- Bundled and hub-installed skills are off-limits.
- Curator never deletes skills. The most destructive action is archive.
- Pinned skills are exempt from auto-transitions and review passes.

## Cost Model

- Deterministic inactivity and prune sweeps cost zero tokens.
- The optional consolidation pass is off by default.
- Enable consolidation with `curator.consolidate: true` or `hermes curator run --consolidate`.

## Telemetry

Skill-usage state is stored in `~/.hermes/skills/.usage.json` with fields such
as `use_count`, `view_count`, `patch_count`, `last_activity_at`, `state`, and
`pinned`.

## Config

Key `curator.*` settings include:

- `enabled`
- `interval_hours`
- `min_idle_hours`
- `stale_after_days`
- `archive_after_days`
- `backup.*`

## Verification

- User docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/curator
- Core files: `agent/curator.py`, `agent/curator_backup.py`, `tools/skill_usage.py`
