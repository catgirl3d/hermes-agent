import {
  type AppendMessage,
  AssistantRuntimeProvider,
  ExportedMessageRepository,
  type ExternalStoreAdapter,
  type ThreadMessage
} from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { lazy, Profiler, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { Thread } from '@/components/assistant-ui/thread'
import { Backdrop } from '@/components/Backdrop'
import { COMPOSER_HEART_CONFIG, HeartField } from '@/components/chat/vibe-hearts'
import { PromptOverlays } from '@/components/prompt-overlays'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ErrorState } from '@/components/ui/error-state'
import type { HermesGateway } from '@/hermes'
import { useI18n } from '@/i18n'
import type { ChatMessage } from '@/lib/chat-messages'
import {
  coalesceToolOnlyAssistants,
  createToolMergeCache,
  sessionTitle,
  toRuntimeMessage
} from '@/lib/chat-runtime'
import {
  type RuntimeAdapterSyncMetrics,
  useIncrementalExternalStoreRuntime
} from '@/lib/incremental-external-store-runtime'
import {
  activeSessionSwitchTraceRequestId,
  elapsedSinceActiveSessionSwitchStage,
  markActiveSessionSwitchTrace,
  markActiveSessionSwitchTraceForRequest,
  measureActiveSessionSwitchTrace
} from '@/lib/session-switch-trace'
import { cn } from '@/lib/utils'
import type { ComposerAttachment } from '@/store/composer'
import { $pinnedSessionIds } from '@/store/layout'
import { $petActive } from '@/store/pet'
import { $petOverlayActive } from '@/store/pet-overlay'
import { $gatewaySwapTarget } from '@/store/profile'
import {
  $currentCwd,
  $currentModel,
  $currentProvider,
  $freshDraftReady,
  $gatewayState,
  $introPersonality,
  $introSeed,
  $resumeExhaustedSessionId,
  $selectedStoredSessionId,
  $sessions,
  $sessionViewActiveSessionId,
  $sessionViewAwaitingResponse,
  $sessionViewBusy,
  $sessionViewLastVisibleMessageIsUser,
  $sessionViewMessagesEmpty,
  $sessionViewSnapshot,
  $sessionViewStoredSessionId,
  sessionPinId
} from '@/store/session'
import { isSecondaryWindow, isWatchWindow } from '@/store/windows'

import { routeSessionId } from '../routes'
import { titlebarHeaderBaseClass, titlebarHeaderShadowClass, titlebarHeaderTitleClass } from '../shell/titlebar'
import type { ToolResultPruneResponse } from '../types'

import { ChatDropOverlay } from './chat-drop-overlay'
import { ChatSwapOverlay } from './chat-swap-overlay'
import { requestComposerInsert, requestComposerInsertRefs } from './composer/focus'
import { droppedFileInlineRefs, type SessionDragPayload, sessionInlineRef } from './composer/inline-refs'
import type { ChatBarState } from './composer/types'
import { type DroppedFile, partitionDroppedFiles } from './hooks/use-composer-actions'
import { useComposerIntentPrewarm } from './hooks/use-composer-intent-prewarm'
import { useFileDropZone } from './hooks/use-file-drop-zone'
import { ScrollToBottomButton } from './scroll-to-bottom-button'
import { SessionActionsMenu } from './sidebar/session-actions-menu'
import { threadLoadingState } from './thread-loading'

const LazyChatBar = lazy(() => import('./composer').then(module => ({ default: module.ChatBar })))

interface ChatViewProps extends Omit<React.ComponentProps<'div'>, 'onSubmit'> {
  gateway: HermesGateway | null
  modelMenuContent?: React.ReactNode
  onToggleSelectedPin: () => void
  onDeleteSelectedSession: () => void
  onApplyToolResultPrune: (preview: ToolResultPruneResponse) => Promise<ToolResultPruneResponse>
  onPreviewToolResultPrune: (toolNames?: string[]) => Promise<ToolResultPruneResponse>
  onCancel: () => Promise<void> | void
  onAddContextRef: (refText: string, label?: string, detail?: string) => void
  onAddUrl: (url: string) => void
  onBranchInNewChat: (messageId: string) => void
  maxVoiceRecordingSeconds?: number
  onAttachImageBlob: (blob: Blob) => Promise<boolean | void> | boolean | void
  onAttachDroppedItems: (candidates: DroppedFile[]) => Promise<boolean | void> | boolean | void
  onPasteClipboardImage: (opts?: { silent?: boolean }) => Promise<boolean> | void
  onPickFiles: () => void
  onPickFolders: () => void
  onPickImages: () => void
  onRemoveAttachment: (id: string) => void
  onSteer: (text: string) => Promise<boolean> | boolean
  onSubmit: (
    text: string,
    options?: { attachments?: ComposerAttachment[]; fromQueue?: boolean }
  ) => Promise<boolean> | boolean
  onThreadMessagesChange: (messages: readonly ThreadMessage[]) => void
  onEdit: (message: AppendMessage) => Promise<void>
  onReload: (parentId: string | null) => Promise<void>
  onRestoreToMessage?: (messageId: string, target?: { text?: string; userOrdinal?: number | null }) => Promise<void>
  onRetryResume: (sessionId: string) => void
  onTranscribeAudio?: (audio: Blob) => Promise<string>
  onDismissError?: (messageId: string) => void
}

interface ChatHeaderProps {
  activeSessionId: null | string
  busy: boolean
  isRoutedSessionView: boolean
  onApplyToolResultPrune: (preview: ToolResultPruneResponse) => Promise<ToolResultPruneResponse>
  onDeleteSelectedSession: () => void
  onPreviewToolResultPrune: (toolNames?: string[]) => Promise<ToolResultPruneResponse>
  onToggleSelectedPin: () => void
  selectedSessionId: null | string
}

function ChatHeader({
  activeSessionId,
  busy,
  isRoutedSessionView,
  onApplyToolResultPrune,
  onDeleteSelectedSession,
  onPreviewToolResultPrune,
  onToggleSelectedPin,
  selectedSessionId
}: ChatHeaderProps) {
  const sessions = useStore($sessions)
  const pinnedSessionIds = useStore($pinnedSessionIds)

  const activeStoredSession =
    sessions.find(session => session.id === selectedSessionId || session._lineage_root_id === selectedSessionId) || null

  const title = activeStoredSession ? sessionTitle(activeStoredSession) : 'New session'

  // Pins live on the durable lineage-root id, but selectedSessionId is the live
  // (tip) id — resolve through the loaded row so the menu reflects the pin
  // state after auto-compression rotates the id.
  const selectedIsPinned = activeStoredSession
    ? pinnedSessionIds.includes(sessionPinId(activeStoredSession))
    : selectedSessionId
      ? pinnedSessionIds.includes(selectedSessionId)
      : false

  // Secondary windows (new-session scratch, subagent watch, cmd-click pop-out)
  // are compact side panels — they drop the session-actions header + border
  // entirely. A brand-new draft has nothing to pin/delete/rename either.
  if (isSecondaryWindow() || (!selectedSessionId && !activeSessionId && !isRoutedSessionView)) {
    return null
  }

  return (
    <header className={cn(titlebarHeaderBaseClass, isRoutedSessionView && titlebarHeaderShadowClass)}>
      <div
        className={titlebarHeaderTitleClass}
        style={{
          maxWidth:
            'calc(100vw - var(--titlebar-content-inset,0px) - var(--titlebar-tools-right) - var(--titlebar-tools-width) - 1.5rem)'
        }}
      >
        <SessionActionsMenu
          align="start"
          onApplyToolResultPrune={!busy && activeSessionId ? onApplyToolResultPrune : undefined}
          onDelete={selectedSessionId ? onDeleteSelectedSession : undefined}
          onPin={selectedSessionId ? onToggleSelectedPin : undefined}
          onPreviewToolResultPrune={!busy && activeSessionId ? onPreviewToolResultPrune : undefined}
          pinned={selectedIsPinned}
          sessionId={selectedSessionId || activeSessionId || ''}
          sideOffset={8}
          title={title}
        >
          <Button
            className="pointer-events-auto flex h-6 min-w-0 max-w-full gap-1 overflow-hidden border border-transparent bg-transparent px-2 py-0 text-(--ui-text-secondary) hover:border-(--ui-stroke-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground data-[state=open]:border-(--ui-stroke-tertiary) data-[state=open]:bg-(--ui-control-active-background) [-webkit-app-region:no-drag]"
            type="button"
            variant="ghost"
          >
            <h2 className="min-w-0 flex-1 truncate text-[0.75rem] font-medium leading-none">{title}</h2>
            <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="chevron-down" size="0.8125rem" />
          </Button>
        </SessionActionsMenu>
      </div>
    </header>
  )
}

interface ChatRuntimeBoundaryProps {
  children: React.ReactNode
  onCancel: () => Promise<void> | void
  onEdit: (message: AppendMessage) => Promise<void>
  onReload: (parentId: string | null) => Promise<void>
  onThreadMessagesChange: (messages: readonly ThreadMessage[]) => void
  traceSessionId: null | string
}

/**
 * Owns the $messages subscription and the assistant-ui external-store runtime.
 *
 * Isolated from ChatView so the per-token delta flush (which replaces the
 * $messages atom ~30×/s during streaming) only re-renders this component and
 * the runtime provider. The children (Thread, ChatBar) are created by
 * ChatView, whose render output is stable across flushes — so React bails out
 * of re-rendering them by element identity and the stream's render cost stays
 * confined to the streaming message's own subtree.
 */
function ChatRuntimeBoundary({
  children,
  onCancel,
  onEdit,
  onReload,
  onThreadMessagesChange,
  traceSessionId
}: ChatRuntimeBoundaryProps) {
  const renderStartedAt = performance.now()
  const traceRequestId = activeSessionSwitchTraceRequestId(traceSessionId)

  const coldViewPublishToRenderStartMs = elapsedSinceActiveSessionSwitchStage(
    traceSessionId,
    'cold-view-published',
    renderStartedAt,
    traceRequestId
  )

  const sessionViewSnapshot = useStore($sessionViewSnapshot)
  const { busy, messages, runtimeSyncMode } = sessionViewSnapshot
  const runtimeMessageCacheRef = useRef(new WeakMap<ChatMessage, ThreadMessage>())
  const toolMergeCacheRef = useRef(createToolMergeCache())

  const layoutCommittedAtRef = useRef<number | null>(null)
  const layoutSyncedSnapshotRef = useRef<typeof sessionViewSnapshot | null>(null)

  const lastRuntimeLayoutTraceRef = useRef<{
    adapter: ExternalStoreAdapter<ThreadMessage>
    requestId: number | undefined
  } | null>(null)

  const runtimeMessageRepository = useMemo(() => {
    let coalescedCount = 0
    let visibleMessageCount = 0
    let headIdPresent = false

    return measureActiveSessionSwitchTrace(
      traceSessionId,
      'runtime-message-repository-built',
      () => {
        const items: { message: ThreadMessage; parentId: string | null }[] = []
        const branchParentByGroup = new Map<string, string | null>()
        let visibleParentId: string | null = null
        let headId: string | null = null
        const coalescedMessages = Array.from(coalesceToolOnlyAssistants(messages, toolMergeCacheRef.current))

        coalescedCount = coalescedMessages.length

        for (const message of coalescedMessages) {
          let parentId = visibleParentId

          if (message.role === 'assistant' && message.branchGroupId) {
            if (!branchParentByGroup.has(message.branchGroupId)) {
              branchParentByGroup.set(message.branchGroupId, visibleParentId)
            }

            parentId = branchParentByGroup.get(message.branchGroupId) ?? null
          }

          const cachedMessage = runtimeMessageCacheRef.current.get(message)
          const runtimeMessage = cachedMessage ?? toRuntimeMessage(message)

          if (!cachedMessage) {
            runtimeMessageCacheRef.current.set(message, runtimeMessage)
          }

          items.push({ message: runtimeMessage, parentId })

          if (!message.hidden) {
            visibleParentId = message.id
            headId = message.id
            visibleMessageCount += 1
          }
        }

        headIdPresent = headId !== null

        return ExportedMessageRepository.fromBranchableArray(items, { headId })
      },
      () => ({
        coalescedCount,
        headIdPresent,
        messageCount: messages.length,
        repositoryVisibleMessageCount: visibleMessageCount
      })
    )
  }, [messages, traceSessionId])

  const onRuntimeAdapterSync = useCallback(
    ({ durationMs, messageCount }: RuntimeAdapterSyncMetrics) => {
      const syncFinishedAt = performance.now()
      const layoutCommittedAt = layoutCommittedAtRef.current

      if (runtimeSyncMode === 'layout') {
        layoutSyncedSnapshotRef.current = sessionViewSnapshot
      }

      markActiveSessionSwitchTraceForRequest(traceSessionId, traceRequestId, 'runtime-adapter-synced', {
        layoutCommitToSyncStartMs:
          layoutCommittedAt === null
            ? undefined
            : Math.round(Math.max(0, syncFinishedAt - durationMs - layoutCommittedAt) * 10) / 10,
        messageCount,
        operationDurationMs: durationMs
      })
    },
    [runtimeSyncMode, sessionViewSnapshot, traceRequestId, traceSessionId]
  )

  const onRuntimeAdapterSyncStart = useCallback(
    ({ messageCount }: Pick<RuntimeAdapterSyncMetrics, 'messageCount'>) => {
      markActiveSessionSwitchTraceForRequest(traceSessionId, traceRequestId, 'runtime-adapter-sync-started', {
        messageCount
      })
    },
    [traceRequestId, traceSessionId]
  )

  const runtimeAdapter = useMemo<ExternalStoreAdapter<ThreadMessage>>(
    () => ({
      messageRepository: runtimeMessageRepository,
      isRunning: busy,
      setMessages: onThreadMessagesChange,
      onNew: async () => {
        // Submission is handled explicitly by ChatBar.
        // Keeping this no-op avoids duplicate prompt.submit calls.
      },
      onEdit,
      onCancel: async () => onCancel(),
      onReload
    }),
    [busy, onCancel, onEdit, onReload, onThreadMessagesChange, runtimeMessageRepository]
  )

  useLayoutEffect(() => {
    const layoutCommittedAt = performance.now()
    const lastTrace = lastRuntimeLayoutTraceRef.current

    layoutCommittedAtRef.current = layoutCommittedAt

    if (lastTrace?.adapter === runtimeAdapter && lastTrace.requestId === traceRequestId) {
      return
    }

    lastRuntimeLayoutTraceRef.current = { adapter: runtimeAdapter, requestId: traceRequestId }
    markActiveSessionSwitchTraceForRequest(traceSessionId, traceRequestId, 'runtime-boundary-layout-commit', {
      coldViewPublishToRenderStartMs,
      messageCount: messages.length,
      renderToLayoutCommitMs: Math.round((layoutCommittedAt - renderStartedAt) * 10) / 10
    })
  })

  const pendingRuntimeSyncMode =
    runtimeSyncMode === 'layout' && layoutSyncedSnapshotRef.current !== sessionViewSnapshot ? 'layout' : 'passive'

  const runtime = useIncrementalExternalStoreRuntime<ThreadMessage>(runtimeAdapter, {
    onAdapterSync: onRuntimeAdapterSync,
    onAdapterSyncStart: onRuntimeAdapterSyncStart,
    syncMode: pendingRuntimeSyncMode
  })

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}

export function ChatView({
  className,
  gateway,
  modelMenuContent,
  onToggleSelectedPin,
  onDeleteSelectedSession,
  onApplyToolResultPrune,
  onCancel,
  onAddContextRef,
  onAddUrl,
  onAttachImageBlob,
  onAttachDroppedItems,
  onBranchInNewChat,
  maxVoiceRecordingSeconds,
  onPasteClipboardImage,
  onPreviewToolResultPrune,
  onPickFiles,
  onPickFolders,
  onPickImages,
  onRemoveAttachment,
  onSteer,
  onSubmit,
  onThreadMessagesChange,
  onEdit,
  onReload,
  onRestoreToMessage,
  onRetryResume,
  onTranscribeAudio,
  onDismissError
}: ChatViewProps) {
  const location = useLocation()
  const { t } = useI18n()
  const activeSessionId = useStore($sessionViewActiveSessionId)
  const prewarmOnIntent = useComposerIntentPrewarm({ gateway, sessionId: activeSessionId })
  const awaitingResponse = useStore($sessionViewAwaitingResponse)
  const busy = useStore($sessionViewBusy)
  const currentCwd = useStore($currentCwd)
  const currentModel = useStore($currentModel)
  const currentProvider = useStore($currentProvider)
  // A pet anywhere (in-window or popped out) owns the hearts; composer only when none.
  const petActive = useStore($petActive)
  const petOverlayActive = useStore($petOverlayActive)
  const petPresent = petActive || petOverlayActive
  const freshDraftReady = useStore($freshDraftReady)
  const gatewayState = useStore($gatewayState)
  const gatewaySwapTarget = useStore($gatewaySwapTarget)
  const gatewayOpen = gatewayState === 'open'
  const introPersonality = useStore($introPersonality)
  const introSeed = useStore($introSeed)
  // PERF: ChatView must not subscribe to $messages — the atom is replaced on
  // every streaming delta flush (~30×/s) and a subscription here re-renders
  // the entire chat shell (header, chat bar, thread wrapper) per token. The
  // runtime that DOES need the messages lives in ChatRuntimeBoundary below;
  // this component only needs streaming-stable derivations.
  const messagesEmpty = useStore($sessionViewMessagesEmpty)
  const lastVisibleIsUser = useStore($sessionViewLastVisibleMessageIsUser)
  const visibleStoredSessionId = useStore($sessionViewStoredSessionId)
  const selectedSessionId = useStore($selectedStoredSessionId)
  const resumeExhaustedSessionId = useStore($resumeExhaustedSessionId)
  const routedSessionId = routeSessionId(location.pathname)
  const isRoutedSessionView = Boolean(routedSessionId)

  // Navigation intent changes immediately, but the visible snapshot remains on
  // the previous session until the target is completely prepared and published.
  const routeSessionMismatch = isRoutedSessionView && routedSessionId !== visibleStoredSessionId

  // The compact new-session pop-out skips the wordmark/tagline intro — it's a
  // scratch window, not the full-height empty state.
  const showIntro =
    !isSecondaryWindow() &&
    freshDraftReady &&
    !isRoutedSessionView &&
    !selectedSessionId &&
    !activeSessionId &&
    messagesEmpty

  // Session is still loading if the route references a session we haven't
  // resumed yet. Once `activeSessionId` is set (runtime has resumed), the
  // session exists — even if it has zero messages (a brand-new routed
  // session). The flicker where `busy` flips true briefly during hydrate
  // is handled by `threadLoadingState`'s last-visible-user gate.
  //
  // resumeExhausted: the bounded auto-retry in use-route-resume gave up on this
  // routed session (gateway RPC + REST fallback failed through every attempt).
  // Suppress the loader and show an explicit error + manual Retry instead of
  // spinning forever. Gated on the route matching so a stale latch from another
  // session can't blank the current one.
  const resumeExhausted = isRoutedSessionView && resumeExhaustedSessionId === routedSessionId

  const hasVisibleSession = Boolean(visibleStoredSessionId || activeSessionId || !messagesEmpty)

  const loadingSession =
    !resumeExhausted && isRoutedSessionView && !hasVisibleSession && (routeSessionMismatch || !activeSessionId)

  const threadLoading = threadLoadingState(loadingSession, busy, awaitingResponse, lastVisibleIsUser)
  // Hide the composer in the exhausted error state too: there's no live runtime
  // to send to until a retry rebinds one. Watch windows are pure spectators of a
  // subagent run driven elsewhere — no composer, transcript is read-only.
  const watchWindow = isWatchWindow()
  const showChatBar = !routeSessionMismatch && !loadingSession && !resumeExhausted && !watchWindow
  const composerScope = selectedSessionId || activeSessionId || '__new__'
  const [visibleComposerScope, setVisibleComposerScope] = useState<string | null>(null)
  const composerEverMountedRef = useRef(false)
  const composerVisible = showChatBar && visibleComposerScope === composerScope

  if (showChatBar) {
    composerEverMountedRef.current = true
  }

  useEffect(() => {
    if (showChatBar) {
      setVisibleComposerScope(composerScope)
    }
  }, [composerScope, showChatBar])

  const composerShouldMount = !watchWindow && !resumeExhausted && (composerEverMountedRef.current || showChatBar)

  const threadKey = visibleStoredSessionId || activeSessionId || (isRoutedSessionView ? location.pathname : 'new')
  const traceSessionIdRef = useRef<null | string>(selectedSessionId)
  traceSessionIdRef.current = selectedSessionId

  const onThreadRender = useCallback<React.ProfilerOnRenderCallback>(
    (_id, phase, actualDuration, baseDuration) => {
      markActiveSessionSwitchTrace(traceSessionIdRef.current, 'thread-react-commit', {
        actualDurationMs: Math.round(actualDuration * 10) / 10,
        baseDurationMs: Math.round(baseDuration * 10) / 10,
        busy,
        loadingSession,
        messagesEmpty,
        phase,
        routeSessionMismatch
      })
    },
    [busy, loadingSession, messagesEmpty, routeSessionMismatch]
  )

  const onRuntimeBoundaryRender = useCallback<React.ProfilerOnRenderCallback>(
    (_id, phase, actualDuration, baseDuration) => {
      markActiveSessionSwitchTrace(traceSessionIdRef.current, 'runtime-react-commit', {
        actualDurationMs: Math.round(actualDuration * 10) / 10,
        baseDurationMs: Math.round(baseDuration * 10) / 10,
        busy,
        loadingSession,
        messagesEmpty,
        phase,
        routeSessionMismatch
      })
    },
    [busy, loadingSession, messagesEmpty, routeSessionMismatch]
  )

  const chatBarState = useMemo<ChatBarState>(
    () => ({
      model: {
        model: currentModel,
        provider: currentProvider,
        canSwitch: gatewayOpen,
        loading: !gatewayOpen || (!currentModel && !currentProvider),
        modelMenuContent
      },
      tools: {
        enabled: true,
        label: 'Add context'
      },
      voice: {
        enabled: true,
        active: false
      }
    }),
    [currentModel, currentProvider, gatewayOpen, modelMenuContent]
  )

  const composerBindingRef = useRef<{
    cwd: string
    focusKey: string | null
    queueSessionKey: string | null
    sessionId: string | null
    state: ChatBarState
  } | null>(null)

  if (showChatBar) {
    composerBindingRef.current = {
      cwd: currentCwd,
      focusKey: activeSessionId,
      queueSessionKey: selectedSessionId,
      sessionId: activeSessionId,
      state: chatBarState
    }
  }

  const composerBinding = composerBindingRef.current

  // Drop files anywhere in the conversation area, not just on the composer
  // input. In-app drags (project tree / gutter) carry workspace-relative paths
  // the gateway resolves directly, so they stay inline `@file:` refs. OS/Finder
  // drops carry absolute local paths that don't exist on a remote gateway (and
  // images need byte upload for vision), so route them through the attachment
  // pipeline — otherwise the local path leaks into the prompt verbatim.
  const onDropFiles = useCallback(
    (candidates: DroppedFile[]) => {
      if (candidates.length > 0) {
        prewarmOnIntent('attachment')
      }

      const { inAppRefs, osDrops } = partitionDroppedFiles(candidates)
      const refs = droppedFileInlineRefs(inAppRefs, currentCwd)

      if (refs.length) {
        requestComposerInsert(refs.join(' '), { mode: 'inline', target: 'main' })
      }

      if (osDrops.length) {
        void onAttachDroppedItems(osDrops)
      }
    },
    [currentCwd, onAttachDroppedItems, prewarmOnIntent]
  )

  // Dropping a sidebar session inserts an @session link the agent can resolve
  // via session_search (carries the source profile, so cross-profile works).
  const onDropSession = useCallback((session: SessionDragPayload) => {
    requestComposerInsertRefs([sessionInlineRef(session)], { intent: 'attachment', target: 'main' })
  }, [])

  const { dragKind, dropHandlers } = useFileDropZone({ enabled: composerVisible, onDropFiles, onDropSession })

  return (
    <div
      className={cn(
        'relative isolate flex h-full min-w-0 flex-col overflow-hidden bg-(--ui-chat-surface-background)',
        className
      )}
    >
      <Backdrop />
      <ChatHeader
        activeSessionId={activeSessionId}
        busy={busy}
        isRoutedSessionView={isRoutedSessionView}
        onApplyToolResultPrune={onApplyToolResultPrune}
        onDeleteSelectedSession={onDeleteSelectedSession}
        onPreviewToolResultPrune={onPreviewToolResultPrune}
        onToggleSelectedPin={onToggleSelectedPin}
        selectedSessionId={selectedSessionId}
      />

      <PromptOverlays />

      <Profiler id="chat-runtime-boundary" onRender={onRuntimeBoundaryRender}>
        <ChatRuntimeBoundary
          onCancel={onCancel}
          onEdit={onEdit}
          onReload={onReload}
          onThreadMessagesChange={onThreadMessagesChange}
          traceSessionId={selectedSessionId}
        >
          <div
            className="relative min-h-0 max-w-full flex-1 overflow-hidden bg-(--ui-chat-surface-background) contain-[layout_paint]"
            data-slot="composer-bounds"
            {...dropHandlers}
          >
            <Profiler id="session-thread" onRender={onThreadRender}>
              <Thread
                clampToComposer={composerVisible}
                cwd={currentCwd}
                gateway={gateway}
                intro={showIntro ? { personality: introPersonality, seed: introSeed } : undefined}
                loading={threadLoading}
                onBranchInNewChat={onBranchInNewChat}
                onCancel={onCancel}
                onDismissError={onDismissError}
                onRestoreToMessage={onRestoreToMessage}
                sessionId={activeSessionId}
                sessionKey={threadKey}
                traceSessionId={selectedSessionId}
              />
            </Profiler>
            {resumeExhausted && routedSessionId && (
              <div className="absolute inset-0 z-10 grid place-items-center bg-(--ui-chat-surface-background) px-8 py-10">
                <ErrorState
                  className="max-w-sm"
                  description={t.desktop.resumeStrandedBody}
                  title={t.desktop.resumeStrandedTitle}
                >
                  <div className="grid justify-items-center">
                    <Button onClick={() => onRetryResume(routedSessionId)} size="sm" variant="outline">
                      {t.desktop.resumeRetry}
                    </Button>
                  </div>
                </ErrorState>
              </div>
            )}
            {showChatBar && <ScrollToBottomButton />}
            {/* Vibe hearts rise from the composer only when no pet is out (else
                they play on the pet). Fired by the core `reaction` event. */}
            {!petPresent && (
              <HeartField
                className="absolute inset-x-0 z-30"
                config={COMPOSER_HEART_CONFIG}
                style={{
                  top: 0,
                  bottom: 'calc(var(--composer-measured-height) + var(--status-stack-measured-height) + 0.25rem)'
                }}
              />
            )}
            <ChatDropOverlay kind={dragKind} />
            <ChatSwapOverlay profile={gatewaySwapTarget} />
          </div>
          {/* Composer renders OUTSIDE the contain:[layout paint] wrapper above:
              that wrapper is a containing block for — and clips — position:fixed
              descendants, so the popped-out (fixed) composer would anchor to the
              chat column (which shifts/resizes with the sidebars) and get clipped
              off-screen instead of floating against the viewport. As a sibling it
              anchors to the outer relative container instead: docked is absolute
              (identical placement), floating resolves against the viewport. Both
              states stay mounted after the first visible bind, so
              dock⇄float never remounts its editor. */}
          {composerShouldMount && composerBinding && (
            <div
              aria-hidden={!composerVisible}
              hidden={!composerVisible}
              inert={composerVisible ? undefined : true}
            >
              <Suspense fallback={null}>
                <LazyChatBar
                  busy={composerVisible ? busy : false}
                  cwd={composerBinding.cwd}
                  disabled={!composerVisible || !gatewayOpen}
                  focusKey={composerBinding.focusKey}
                  gateway={gateway}
                  maxRecordingSeconds={maxVoiceRecordingSeconds}
                  onAddContextRef={onAddContextRef}
                  onAddUrl={onAddUrl}
                  onAttachDroppedItems={onAttachDroppedItems}
                  onAttachImageBlob={onAttachImageBlob}
                  onCancel={onCancel}
                  onIntent={prewarmOnIntent}
                  onPasteClipboardImage={onPasteClipboardImage}
                  onPickFiles={onPickFiles}
                  onPickFolders={onPickFolders}
                  onPickImages={onPickImages}
                  onRemoveAttachment={onRemoveAttachment}
                  onSteer={onSteer}
                  onSubmit={onSubmit}
                  onTranscribeAudio={onTranscribeAudio}
                  queueSessionKey={composerBinding.queueSessionKey}
                  sessionId={composerBinding.sessionId}
                  state={composerBinding.state}
                />
              </Suspense>
            </div>
          )}
        </ChatRuntimeBoundary>
      </Profiler>
    </div>
  )
}
