import { ThreadPrimitive, useAuiEvent, useAuiState } from '@assistant-ui/react'
import {
  type ComponentProps,
  type CSSProperties,
  type FC,
  memo,
  Profiler,
  type ProfilerOnRenderCallback,
  type ReactNode,
  useCallback,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useStickToBottom } from 'use-stick-to-bottom'

import { useI18n } from '@/i18n'
import {
  activeSessionSwitchTraceRequestId,
  elapsedSinceActiveSessionSwitchStage,
  markActiveSessionSwitchTrace,
  markActiveSessionSwitchTraceForRequest,
  measureRenderCommitPhases
} from '@/lib/session-switch-trace'
import { cn } from '@/lib/utils'
import {
  onScrollToBottomRequest,
  onThreadEditClose,
  onThreadEditOpen,
  resetThreadScroll,
  setThreadAtBottom
} from '@/store/thread-scroll'
import { isSecondaryWindow } from '@/store/windows'

import { MessageRenderBoundary } from '../message-render-boundary'

type ThreadMessageComponents = ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components']

export type MessageGroup = { id: string; weight: number } & (
  | { index: number; kind: 'standalone' }
  | { indices: number[]; kind: 'turn' }
)

// REBASE INVARIANT: keep automatic mounting bounded to one complete turn.
// Do not restore the 60 -> 300 rAF/startTransition backfill from upstream
// 0f05aaa2b/c856f3645. It caused a second mass message-layout commit 500-1000ms
// after the target session had painted, even with hiddenGroupCount === 0.
// Keep upstream's render-phase reset and shortened scroll settling, but mount
// older turns only through the explicit "Show earlier" action below.
const TURN_RENDER_BATCH = 2
const PART_RENDER_BUDGET = 300

interface ThreadMessageListProps {
  clampToComposer: boolean
  components: ThreadMessageComponents
  emptyPlaceholder?: ReactNode
  loadingIndicator?: ReactNode
  sessionKey?: string | null
  traceSessionId?: string | null
}

// Group each user message with the assistant turn(s) that follow it so the
// human bubble can `position: sticky` against the scroller across its whole
// turn (see StickyHumanMessageContainer in thread.tsx).
export function buildGroups(signature: string): MessageGroup[] {
  if (!signature) {
    return []
  }

  const messages = signature.split('\n').map(row => {
    const [index, id, role, weight] = row.split(':')

    return { id, index: Number(index), role, weight: Number(weight) || 1 }
  })

  const groups: MessageGroup[] = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]

    if (message.role !== 'user') {
      groups.push({ id: message.id, index: message.index, kind: 'standalone', weight: message.weight })

      continue
    }

    const indices = [message.index]
    let weight = message.weight

    while (i + 1 < messages.length && messages[i + 1].role !== 'user') {
      weight += messages[++i].weight
      indices.push(messages[i].index)
    }

    groups.push({ id: message.id, indices, kind: 'turn', weight })
  }

  return groups
}

// Walk newest-first until either the turn or rendered-part budget is met.
// Standalone messages adjacent to the selected turn remain visible, and a turn
// is never split even when that one turn exceeds the part budget.
export function firstVisibleGroupIndex(
  groups: readonly MessageGroup[],
  visibleTurnLimit: number,
  partBudget: number
): number {
  let firstVisible = groups.length
  let renderedParts = 0
  let renderedTurns = 0

  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]

    if (group.kind === 'turn' && renderedTurns >= visibleTurnLimit) {
      break
    }

    renderedParts += group.weight
    renderedTurns += group.kind === 'turn' ? 1 : 0
    firstVisible = index

    if (renderedParts >= partBudget) {
      break
    }
  }

  return firstVisible
}

const ThreadMessageListInner: FC<ThreadMessageListProps> = ({
  clampToComposer,
  components,
  emptyPlaceholder,
  loadingIndicator,
  sessionKey,
  traceSessionId = null
}) => {
  const renderStartedAt = performance.now()
  let renderBodyFinishedAt = renderStartedAt
  const traceRequestId = activeSessionSwitchTraceRequestId(traceSessionId)

  const runtimeSyncStartToRenderStartMs = elapsedSinceActiveSessionSwitchStage(
    traceSessionId,
    'runtime-adapter-sync-started',
    renderStartedAt,
    traceRequestId
  )

  const messageSignature = useAuiState(s =>
    s.thread.messages
      .map((message, index) => `${index}:${message.id}:${message.role}:${message.content?.length ?? 1}`)
      .join('\n')
  )

  const { t } = useI18n()
  const groups = buildGroups(messageSignature)
  const renderEmpty = groups.length === 0 && Boolean(emptyPlaceholder)

  // use-stick-to-bottom owns scrollTop (single writer): follow while locked,
  // escape on user scroll-up, re-lock at bottom. Snap instantly, not spring — a
  // spring can't tell live-token growth from a session-switch bulk relayout, and
  // chasing the latter reads as the view scrolling to random spots before
  // settling. Its refs hang off our own DOM so the sticky human bubbles survive.
  const { scrollRef, contentRef, isAtBottom, scrollToBottom, stopScroll } = useStickToBottom({
    initial: 'instant',
    resize: 'instant'
  })

  const [renderWindow, setRenderWindow] = useState({
    partBudget: PART_RENDER_BUDGET,
    sessionKey,
    turnLimit: TURN_RENDER_BATCH
  })

  const sessionWindowChanged = renderWindow.sessionKey !== sessionKey

  if (sessionWindowChanged) {
    setRenderWindow({ partBudget: PART_RENDER_BUDGET, sessionKey, turnLimit: TURN_RENDER_BATCH })
  }

  const effectiveRenderBudget = sessionWindowChanged ? PART_RENDER_BUDGET : renderWindow.partBudget
  const effectiveTurnLimit = sessionWindowChanged ? TURN_RENDER_BATCH : renderWindow.turnLimit
  const hiddenCount = firstVisibleGroupIndex(groups, effectiveTurnLimit, effectiveRenderBudget)
  const visibleGroups = hiddenCount > 0 ? groups.slice(hiddenCount) : groups

  const mountedMessageCount = visibleGroups.reduce(
    (count, group) => count + (group.kind === 'turn' ? group.indices.length : 1),
    0
  )

  const restoreFromBottomRef = useRef<number | null>(null)
  const lastLayoutTraceKeyRef = useRef<string | null>(null)
  const insertionCommitRef = useRef<{ at: number; traceKey: string } | null>(null)
  const traceKey = `${traceRequestId ?? 'inactive'}:${traceSessionId ?? ''}:${sessionKey ?? ''}:${messageSignature}`
  // Secondary windows (new-session scratch, subagent watch, cmd-click pop-out)
  // hide the titlebar tool cluster + session header, but the OS traffic lights
  // still sit in the top-left, so reserve the titlebar gap above the transcript.
  const secondaryWindow = isSecondaryWindow()
  // NB: CSS calc() requires whitespace around the +/- operator. This string is
  // assigned verbatim to the --sticky-human-top inline style below (it does not
  // go through Tailwind, which would auto-space it), so the spaces are load-
  // bearing — without them the declaration is invalid, gets dropped, and the
  // sticky user bubble falls back to its ~4px default and slides under the OS
  // traffic lights.
  const secondaryTitlebarGap = 'calc(var(--titlebar-height) + 0.75rem)'

  const threadContentTopPad = secondaryWindow
    ? 'pt-[calc(var(--titlebar-height)+0.75rem)]'
    : 'pt-[calc(var(--titlebar-height)-0.5rem)]'

  const onMessageListRender = useCallback<ProfilerOnRenderCallback>(
    (_id, phase, actualDuration, baseDuration) => {
      markActiveSessionSwitchTrace(traceSessionId, 'thread-message-list-react-commit', {
        actualDurationMs: Math.round(actualDuration * 10) / 10,
        baseDurationMs: Math.round(baseDuration * 10) / 10,
        groupCount: groups.length,
        hiddenGroupCount: hiddenCount,
        phase,
        renderBudget: effectiveRenderBudget,
        renderEmpty,
        visibleTurnLimit: effectiveTurnLimit,
        visibleGroupCount: visibleGroups.length
      })
    },
    [effectiveRenderBudget, effectiveTurnLimit, groups.length, hiddenCount, renderEmpty, traceSessionId, visibleGroups.length]
  )

  useEffect(() => setThreadAtBottom(isAtBottom), [isAtBottom])
  useEffect(() => () => resetThreadScroll(), [])

  // Floating jump button (outside this subtree) → return to the bottom.
  useEffect(() => onScrollToBottomRequest(() => void scrollToBottom()), [scrollToBottom])

  const endEditHold = useCallback(() => {
    scrollRef.current?.removeAttribute('data-editing')
  }, [scrollRef])

  // Inline edit grows a sticky bubble. Escape before focus/layout so the
  // resize-follow can't snap scrollTop; native anchoring holds the viewport.
  const beginEditHold = useCallback(() => {
    const el = scrollRef.current

    if (!el) {
      return
    }

    endEditHold()
    stopScroll()
    el.setAttribute('data-editing', 'true')
  }, [endEditHold, scrollRef, stopScroll])

  useEffect(() => onThreadEditOpen(beginEditHold), [beginEditHold])
  useEffect(() => onThreadEditClose(endEditHold), [endEditHold])
  useEffect(() => () => endEditHold(), [endEditHold])

  useInsertionEffect(() => {
    if (traceRequestId !== undefined) {
      insertionCommitRef.current = { at: performance.now(), traceKey }
    }
  })

  useLayoutEffect(() => {
    const layoutCommittedAt = performance.now()
    const insertionCommit = insertionCommitRef.current

    if (lastLayoutTraceKeyRef.current === traceKey) {
      return
    }

    lastLayoutTraceKeyRef.current = traceKey

    const renderCommitPhases =
      insertionCommit?.traceKey === traceKey
        ? measureRenderCommitPhases(renderStartedAt, renderBodyFinishedAt, insertionCommit.at, layoutCommittedAt)
        : undefined

    markActiveSessionSwitchTraceForRequest(traceSessionId, traceRequestId, 'thread-message-list-layout-commit', {
      groupCount: groups.length,
      hiddenGroupCount: hiddenCount,
      insertionCommitToLayoutMs: renderCommitPhases?.insertionCommitToLayoutMs,
      mountedMessageCount,
      renderBodyDurationMs: renderCommitPhases?.renderBodyDurationMs,
      renderToInsertionCommitMs: renderCommitPhases?.renderToInsertionCommitMs,
      renderToLayoutCommitMs: Math.round((layoutCommittedAt - renderStartedAt) * 10) / 10,
      runtimeSyncStartToRenderStartMs,
      visibleGroupCount: visibleGroups.length
    })
  })

  // New run → snap to the latest turn.
  useAuiEvent('thread.runStart', () => void scrollToBottom())

  // Reset the cap and pin to bottom on mount + every session switch (messages
  // swap in place on a long-lived runtime, so sessionKey is the only signal).
  // The swap is multi-step and lays out over many frames; letting the library
  // follow re-pins every frame to a moving target — visible as ~10 scroll jumps.
  // Instead: quiet it, glue to the true bottom until the height holds steady,
  // then hand back locked. Live streaming afterward uses the normal resize follow.
  useLayoutEffect(() => {
    const el = scrollRef.current

    if (!el) {
      return
    }

    stopScroll()
    el.scrollTop = el.scrollHeight

    let frame = 0
    let stableFrames = 0
    let lastHeight = el.scrollHeight

    const settle = () => {
      const node = scrollRef.current

      if (!node) {
        return
      }

      const height = node.scrollHeight

      stableFrames = height === lastHeight ? stableFrames + 1 : 0
      lastHeight = height
      node.scrollTop = height

      // Most session switches are synchronous and stabilize within 2 frames;
      // the old 90-frame ceiling was for slow async image loads. Cap at 15
      // frames to minimize the settle-loop racing markdown paint on every switch.
      if (stableFrames >= 2 || ++frame > 15) {
        void scrollToBottom('instant')

        return
      }

      rafId = requestAnimationFrame(settle)
    }

    let rafId = requestAnimationFrame(settle)

    return () => cancelAnimationFrame(rafId)
  }, [scrollRef, scrollToBottom, sessionKey, stopScroll])

  // Prepend an older page while preserving the on-screen position. The user is
  // scrolled up (reading history) so the stick-to-bottom lock is escaped and
  // won't fight this manual restore. This is intentionally the only path that
  // expands the transcript window; never add an automatic post-paint backfill.
  const showEarlier = useCallback(() => {
    const el = scrollRef.current

    restoreFromBottomRef.current = el ? el.scrollHeight - el.scrollTop : null
    setRenderWindow(current => ({
      partBudget: (current.sessionKey === sessionKey ? current.partBudget : PART_RENDER_BUDGET) + PART_RENDER_BUDGET,
      sessionKey,
      turnLimit: (current.sessionKey === sessionKey ? current.turnLimit : TURN_RENDER_BATCH) + TURN_RENDER_BATCH
    }))
  }, [scrollRef, sessionKey])

  useLayoutEffect(() => {
    const el = scrollRef.current

    if (el && restoreFromBottomRef.current != null) {
      el.scrollTop = el.scrollHeight - restoreFromBottomRef.current
      restoreFromBottomRef.current = null
    }
  }, [renderWindow.partBudget, renderWindow.turnLimit, scrollRef])

  renderBodyFinishedAt = performance.now()

  return (
    <div
      className="relative min-h-0 max-w-full overflow-hidden contain-[layout_paint]"
      style={
        {
          height: clampToComposer ? 'var(--thread-viewport-height)' : '100%',
          ...(secondaryWindow ? { '--sticky-human-top': secondaryTitlebarGap } : {})
        } as CSSProperties
      }
    >
      {secondaryWindow && (
        // Secondary windows hide the titlebar chrome, so the scroller runs to
        // the window's top edge and streamed text slides up under the OS
        // traffic lights. Content padding alone scrolls away with the text — a
        // fixed opaque strip (the titlebar's drag region) masks anything behind
        // it and keeps the window draggable, matching the main window's header.
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 z-10 h-(--titlebar-height) bg-background [-webkit-app-region:drag]"
        />
      )}
      <div
        className="size-full overflow-x-hidden overflow-y-auto overscroll-contain"
        data-following={isAtBottom ? 'true' : 'false'}
        data-slot="aui_thread-viewport"
        ref={scrollRef as React.RefCallback<HTMLDivElement>}
      >
        <Profiler id="thread-message-list" onRender={onMessageListRender}>
          {renderEmpty ? (
            <div
              className="mx-auto grid h-full w-full max-w-(--composer-width) grid-rows-[minmax(0,1fr)_auto] min-w-0 gap-(--conversation-turn-gap) px-6 py-8"
              data-slot="aui_thread-content"
            >
              {emptyPlaceholder}
            </div>
          ) : (
            <div
              className={cn('mx-auto flex w-full max-w-(--composer-width) min-w-0 flex-col px-6', threadContentTopPad)}
              data-slot="aui_thread-content"
              ref={contentRef as React.RefCallback<HTMLDivElement>}
            >
              {hiddenCount > 0 && (
                <button
                  className="mx-auto mb-(--conversation-turn-gap) rounded-full border border-border/65 bg-(--composer-fill) px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={showEarlier}
                  type="button"
                >
                  {t.assistant.thread.showEarlier}
                </button>
              )}
              {visibleGroups.map(group => (
                <div
                  className="flex min-w-0 flex-col gap-(--conversation-turn-gap) pb-(--conversation-turn-gap)"
                  key={group.id}
                >
                  <MessageRenderBoundary resetKey={messageSignature}>
                    {group.kind === 'turn' ? (
                      <div
                        className="composer-human-ai-pair-container relative flex min-w-0 flex-col gap-(--conversation-turn-gap)"
                        data-slot="aui_turn-pair"
                      >
                        {group.indices.map(index => (
                          <ThreadPrimitive.MessageByIndex components={components} index={index} key={index} />
                        ))}
                      </div>
                    ) : (
                      <ThreadPrimitive.MessageByIndex components={components} index={group.index} />
                    )}
                  </MessageRenderBoundary>
                </div>
              ))}
              {loadingIndicator}
              {clampToComposer && (
                <div
                  aria-hidden="true"
                  className="shrink-0"
                  data-slot="aui_composer-clearance"
                  style={{ height: 'var(--thread-last-message-clearance)' }}
                />
              )}
            </div>
          )}
        </Profiler>
      </div>
    </div>
  )
}

export const ThreadMessageList = memo(ThreadMessageListInner)
