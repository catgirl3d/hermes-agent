# Desktop Session Switch Rebase Guide

This document protects the desktop cold session-switch behavior that was
verified manually on `rebase8-on-main` and restored during the 2026-07-21
rebase of `rebase9-v1` onto `upstream/main`.

Read this before resolving conflicts in desktop chat, session state, composer,
or multi-pane code. A conflict can compile and pass shallow tests while still
changing the visible A -> B switch behavior.

## Confirmed Behavior

For a cold primary-chat switch from session A to session B:

1. The route and sidebar selection move to B.
2. The visible snapshot still belongs to A until B is ready.
3. `routeSessionMismatch` suppresses A's transcript.
4. The thread displays the session loader during the cold wait.
5. The composer stays mounted, but is hidden and inert.
6. When B is ready, its complete snapshot is published.
7. The assistant-ui runtime receives the identity change with layout sync so B
   is visible before paint without a stale A frame.

This is the behavior the user verified on `rebase8-on-main`.

Do not replace it with the alternative where the complete A view remains
visible and inert until B replaces it atomically. That approach was tested and
explicitly rejected because it did not match the verified rebase8 behavior.

## Source Of Truth

`$selectedStoredSessionId` is navigation/sidebar intent. It is allowed to point
to B while the displayed session snapshot still belongs to A.

The primary chat's displayed session identity, transcript, and run state must
come from `$sessionViewSnapshot` through its computed atoms:

- `$sessionViewActiveSessionId`
- `$sessionViewStoredSessionId`
- `$sessionViewMessages`
- `$sessionViewMessagesEmpty`
- `$sessionViewBusy`
- `$sessionViewAwaitingResponse`
- `$sessionViewLastVisibleMessageIsUser`

The relevant boundary is:

`apps/desktop/src/app/chat/session-view.tsx`

The expected hybrid resolution is equivalent to:

```tsx
export const PRIMARY_SESSION_VIEW: SessionView = {
  kind: 'primary',
  $awaitingResponse: $sessionViewAwaitingResponse,
  $busy: $sessionViewBusy,
  $cwd: $currentCwd,
  $fast: $currentFastMode,
  $lastVisibleIsUser: $sessionViewLastVisibleMessageIsUser,
  $messages: $sessionViewMessages,
  $messagesEmpty: $sessionViewMessagesEmpty,
  $model: $currentModel,
  $provider: $currentProvider,
  $reasoningEffort: $currentReasoningEffort,
  $runtimeId: $sessionViewActiveSessionId,
  $storedId: $sessionViewStoredSessionId
}
```

The global model/config atoms are intentional because newer multi-pane UI added
`fast` and `reasoningEffort`. They do not own the displayed session identity or
transcript.

## The Regression To Reject

The bad conflict resolution changes `PRIMARY_SESSION_VIEW` back to global
compatibility atoms:

```tsx
$awaitingResponse
$busy
$lastVisibleMessageIsUser
$messages
$messagesEmpty
$runtimeId: $activeSessionId
$storedId: $selectedStoredSessionId
```

Do not accept this resolution.

It splits one visible chat across two timelines: selected ID can already be B
while runtime/messages still belong to A. Depending on timing, this removes the
cold loader or renders B chrome with A content.

The regression appeared while rebasing the cold-resume work across upstream
commit `3aeded6e3` (`fix(desktop): scope multi-pane model UI and stabilize tile
chrome`). The upstream feature was legitimate; the automatic conflict
resolution was not.

Git rerere may print `Staged '<file>' using previous resolution` and silently
restore the bad global-atom version. Always inspect `session-view.tsx` manually
when rebasing the cold-resume commit, even when Git reports that the conflict is
already resolved.

## Related Invariants

Preserve these session-switch optimizations together:

- `session-transition.ts` suppresses previous messages on route mismatch and
  drives the cold loader.
- `ChatRuntimeBoundary` swaps to the empty adapter with layout sync while
  messages are suppressed.
- Warm, cold, and REST fallback target snapshots publish identity changes with
  layout sync where required.
- The composer remains mounted across switches but is hidden and inert while
  the route does not match the displayed snapshot.
- Do not restore automatic `model.options` or `complete.path` requests on the
  cold-resume path.
- Do not restore a second post-switch transcript commit or automatic transcript
  backfill after paint.

## Rebase Procedure

1. Create a backup ref before rebasing.

   ```bash
   git branch backup/<branch>-pre-rebase-<date>
   ```

2. Rebase onto the intended upstream ref.

3. At the cold-resume conflict, inspect all staged files. Do not trust rerere
   for `session-view.tsx`.

4. Keep snapshot-owned primary identity/transcript/run atoms while preserving
   newly required UI fields such as `fast` and `reasoningEffort`.

5. Do not resolve the whole file with `--ours` or `--theirs`. The correct result
   is deliberately a hybrid.

6. Preserve newly required `ClientSessionState` fields in snapshots and test
   fixtures. As of this rebase, this includes `interimBoundaryPending`.

7. Preserve the tile pruning delegate methods when upstream and targeted tool
   pruning overlap:

   - `previewToolResultPrune`
   - `applyToolResultPrune`

8. Keep sidebar row subscriptions isolated with per-row selectors. Subscribing
   every row to whole selection/status arrays passes behavior tests but regresses
   sidebar performance.

## Required Validation

From `apps/desktop`:

```bash
npm run typecheck
npx vitest run \
  src/app/chat/index.test.tsx \
  src/app/chat/session-tile.test.tsx \
  src/app/chat/sidebar/session-row.test.tsx \
  src/app/contrib/hooks/use-session-tile-delegate.test.ts \
  src/app/session/hooks/use-session-actions.test.tsx \
  src/app/session/hooks/use-session-state-cache.test.tsx \
  src/lib/incremental-external-store-runtime.test.tsx
```

Then manually test two genuinely cold chats. The expected visible sequence is:

```text
click B -> loader -> B transcript
```

The following sequences are regressions:

```text
click B -> A remains visible -> B transcript
click B -> B header with A transcript -> B transcript
click B -> blank frame without the session loader -> B transcript
```

## Recovery Reference

The known-good pre-rebase backup created on 2026-07-21 is:

```text
backup/rebase9-v1-pre-rebase-20260721
```

Use it for behavioral comparison, not as a wholesale source replacement. Newer
upstream state and APIs still need to be integrated deliberately.
