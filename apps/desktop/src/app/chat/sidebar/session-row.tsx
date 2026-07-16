import type * as React from 'react'
import { memo, useCallback, useMemo, useSyncExternalStore } from 'react'

import { ProfileTag } from '@/app/chat/profile-tag'
import { startSessionDrag } from '@/app/chat/session-drag'
import { PlatformAvatar } from '@/app/messaging/platform-icon'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import type { SessionInfo } from '@/hermes'
import { type Translations, useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { triggerHaptic } from '@/lib/haptics'
import { handoffOriginSource, sessionSourceLabel } from '@/lib/session-source'
import { coarseElapsed } from '@/lib/time'
import { cn } from '@/lib/utils'
import { $backgroundRunningSessionIds } from '@/store/composer-status'
import { $unreadFinishedSessionIds, sessionPinId } from '@/store/session'
import { $sessionColorById } from '@/store/session-color'
import {
  $attentionSessionIds,
  $focusedStoredSessionId,
  $stalledSessionIds,
  $workingSessionIds,
  openSessionTile
} from '@/store/session-states'
import { canOpenSessionWindow, openSessionInNewWindow } from '@/store/windows'

import { SidebarRowBody, SidebarRowGrab, SidebarRowLabel, SidebarRowLead, SidebarRowShell } from './chrome'
import { SessionActionsMenu, SessionContextMenu } from './session-actions-menu'
import { type SessionDotState, sessionDotState, sessionShowsRunningArc } from './session-row-state'
import { useProfilePrewarm } from './use-profile-prewarm'

interface SidebarSessionRowProps extends React.ComponentProps<'div'> {
  session: SessionInfo
  /** TUI-style tree stem for branched sessions (`└─ ` / `├─ `). */
  branchStem?: string
  isPinned: boolean
  onArchiveSession: (sessionId: string) => void
  onBranchSession?: (sessionId: string, profile?: string) => void
  onDeleteSession: (sessionId: string) => void
  onResumeSession: (sessionId: string) => void
  onTogglePin: (sessionId: string) => void
  reorderable?: boolean
  dragging?: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
  /** Highlight rows only when the chat view is active. */
  showSelection?: boolean
  /** Tag the row with its owning profile (initial chip + tooltip). Used by
   *  flat cross-profile lists — Pinned and search results in the All-profiles
   *  view — where no group header communicates ownership (#66003). */
  showProfile?: boolean
}

interface SidebarSessionRowViewProps
  extends Omit<
    SidebarSessionRowProps,
    'onArchiveSession' | 'onBranchSession' | 'onDeleteSession' | 'onResumeSession' | 'onTogglePin' | 'showSelection'
  > {
  hasBackground: boolean
  isSelected: boolean
  isStalled: boolean
  isUnread: boolean
  isWorking: boolean
  needsInput: boolean
  onArchive: () => void
  onBranch?: () => void
  onDelete: () => void
  onPin: () => void
  onResume: () => void
  projectColor: null | string
}

interface ReadableStore<Value> {
  get(): Value
  listen(listener: () => void): () => void
}

function useStoreSelector<Value, Selection>(
  store: ReadableStore<Value>,
  select: (value: Value) => Selection
): Selection {
  const subscribe = useCallback((listener: () => void) => store.listen(listener), [store])
  const getSnapshot = useCallback(() => select(store.get()), [select, store])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useSessionMembership(store: ReadableStore<readonly string[]>, sessionId: string): boolean {
  const select = useCallback((sessionIds: readonly string[]) => sessionIds.includes(sessionId), [sessionId])

  return useStoreSelector(store, select)
}

const AGE_KEY = { day: 'ageDay', hour: 'ageHour', minute: 'ageMin' } as const

function formatAge(seconds: number, r: Translations['sidebar']['row']): string {
  const { unit, value } = coarseElapsed(Date.now() - seconds * 1000)

  // Under a minute reads as "now" — the sidebar never shows a seconds tick.
  return unit === 'second' ? r.ageNow : `${value}${r[AGE_KEY[unit]]}`
}

export const SidebarSessionRow = memo(function SidebarSessionRow({
  session,
  isPinned,
  showSelection = true,
  onArchiveSession,
  onBranchSession,
  onDeleteSession,
  onResumeSession,
  onTogglePin,
  ...props
}: SidebarSessionRowProps) {
  const isSelected = useStoreSelector(
    $focusedStoredSessionId,
    useCallback(
      focusedStoredSessionId => showSelection && focusedStoredSessionId === session.id,
      [session.id, showSelection]
    )
  )
  const isWorking = useSessionMembership($workingSessionIds, session.id)
  const needsInput = useSessionMembership($attentionSessionIds, session.id)
  const isUnread = useSessionMembership($unreadFinishedSessionIds, session.id)
  const isStalled = useSessionMembership($stalledSessionIds, session.id)
  const hasBackground = useSessionMembership($backgroundRunningSessionIds, session.id)
  const projectColor = useStoreSelector(
    $sessionColorById,
    useCallback(sessionColors => sessionColors[session.id] ?? null, [session.id])
  )
  const onArchive = useCallback(() => onArchiveSession(session.id), [onArchiveSession, session.id])
  const onDelete = useCallback(() => onDeleteSession(session.id), [onDeleteSession, session.id])
  const onPin = useCallback(() => onTogglePin(sessionPinId(session)), [onTogglePin, session])
  const onResume = useCallback(() => onResumeSession(session.id), [onResumeSession, session.id])
  const onBranch = useMemo(
    () => (onBranchSession ? () => onBranchSession(session.id, session.profile) : undefined),
    [onBranchSession, session.id, session.profile]
  )

  return (
    <SidebarSessionRowView
      {...props}
      hasBackground={hasBackground}
      isPinned={isPinned}
      isSelected={isSelected}
      isStalled={isStalled}
      isUnread={isUnread}
      isWorking={isWorking}
      needsInput={needsInput}
      onArchive={onArchive}
      onBranch={onBranch}
      onDelete={onDelete}
      onPin={onPin}
      onResume={onResume}
      projectColor={projectColor}
      session={session}
    />
  )
})

function SidebarSessionRowView({
  session,
  branchStem,
  hasBackground,
  isPinned,
  isSelected,
  isStalled,
  isUnread,
  isWorking,
  needsInput,
  onArchive,
  onBranch,
  onDelete,
  onPin,
  onResume,
  projectColor,
  reorderable = false,
  dragging = false,
  dragHandleProps,
  showProfile = false,
  className,
  style,
  ref,
  ...rest
}: SidebarSessionRowViewProps) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const { cancelPrewarm, startPrewarm } = useProfilePrewarm(session.profile)
  const title = sessionTitle(session)
  const age = formatAge(session.last_active || session.started_at, r)
  const handleLabel = `Reorder ${title}`
  // A handed-off session's live source is local, but it originated on a
  // messaging platform — surface that origin as a small badge so e.g. a
  // Telegram thread continued here still reads as Telegram.
  const handoffSource = handoffOriginSource(session.handoff_state, session.handoff_platform)
  const handoffLabel = handoffSource ? (sessionSourceLabel(handoffSource) ?? handoffSource) : null
  // Resolve the dot's display state once — the four signals are mutually
  // exclusive by priority, so threading them as booleans through wrappers just
  // to collapse them at the leaf is backwards.
  const dotState = sessionDotState({ hasBackground, isStalled, isUnread, isWorking, needsInput })

  return (
    <SessionContextMenu
      onArchive={onArchive}
      onBranch={onBranch}
      onDelete={onDelete}
      onPin={onPin}
      pinned={isPinned}
      profile={session.profile}
      sessionId={session.id}
      title={title}
    >
      <SidebarRowShell
        actions={
          <div className="relative z-2 grid w-[1.375rem] place-items-center" data-row-actions>
            {!isWorking && (
              <span className="pointer-events-none absolute right-6 top-1/2 min-w-6 -translate-y-1/2 text-right text-[0.625rem] leading-none text-(--ui-text-tertiary) opacity-0 transition-opacity group-hover:opacity-100">
                {age}
              </span>
            )}
            <SessionActionsMenu
              onArchive={onArchive}
              onBranch={onBranch}
              onDelete={onDelete}
              onPin={onPin}
              pinned={isPinned}
              profile={session.profile}
              sessionId={session.id}
              title={title}
            >
              <Button
                aria-label={r.actionsFor(title)}
                className="size-5 rounded-[4px] bg-transparent text-transparent transition-colors duration-100 hover:bg-(--ui-control-active-background) hover:text-foreground focus-visible:bg-(--ui-control-active-background) focus-visible:text-foreground focus-visible:ring-0 data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground group-hover:text-(--ui-text-tertiary) [&_svg]:size-3.5!"
                size="icon"
                variant="ghost"
              >
                <Codicon name="kebab-vertical" size="0.875rem" />
              </Button>
            </SessionActionsMenu>
          </div>
        }
        className={cn(
          'group row-hover relative',
          isSelected && 'bg-(--ui-row-active-background)',
          isWorking && 'text-foreground',
          // Opaque surface while lifted so the dragged row erases what's under
          // it (translucency let the rows below bleed through).
          dragging && 'z-10 cursor-grabbing bg-(--ui-sidebar-surface-background)',
          className
        )}
        data-working={isWorking ? 'true' : undefined}
        onPointerDown={event => {
          // Reorder drags belong to dnd-kit (the grab handle); the ⋯ actions
          // cluster keeps its own gestures. Everything else on the row —
          // including the row-body BUTTON, the natural grab surface — is a
          // session drag source: a POINTER drag on the shared drag session
          // (never native HTML5 DnD: no macOS snap-back, Esc aborts
          // instantly). Sub-threshold releases stay ordinary clicks, so
          // resume / pin / open-in-window are untouched.
          if ((event.target as HTMLElement).closest('[data-reorder-handle], [data-row-actions]')) {
            return
          }

          startSessionDrag({ id: session.id, profile: session.profile || 'default', title }, event)
        }}
        // Hovering a row from another profile (the all-profiles view) telegraphs
        // a cross-profile resume — start that backend's spawn now so the click
        // doesn't pay the full cold boot. Same-profile rows no-op inside
        // prewarmProfileBackend.
        onPointerEnter={startPrewarm}
        onPointerLeave={cancelPrewarm}
        ref={ref}
        style={style}
        {...rest}
      >
        {sessionShowsRunningArc({ isWorking, needsInput }) && <span aria-hidden="true" className="arc-border" />}
        <SidebarRowBody
          className={cn('z-0 group-hover:pr-12', branchStem && 'pl-3.5')}
          // Middle-click = open in a new tab (browser muscle memory). Swallow
          // the mousedown so Chromium doesn't enter autoscroll mode.
          onAuxClick={event => {
            if (event.button === 1) {
              event.preventDefault()
              event.stopPropagation()
              triggerHaptic('selection')
              openSessionTile(session.id, 'center')
            }
          }}
          onClick={event => {
            const mod = event.metaKey || event.ctrlKey

            // ⇧⌘-click → pop into its own window (needs standalone windows).
            if (mod && event.shiftKey && canOpenSessionWindow()) {
              event.preventDefault()
              event.stopPropagation()
              triggerHaptic('selection')
              void openSessionInNewWindow(session.id)

              return
            }

            // ⌘/⌃-click → open in a new tab (stack into main).
            if (mod) {
              event.preventDefault()
              event.stopPropagation()
              triggerHaptic('selection')
              openSessionTile(session.id, 'center')

              return
            }

            // ⇧-click → pin.
            if (event.shiftKey) {
              event.preventDefault()
              event.stopPropagation()
              triggerHaptic('selection')
              onPin()

              return
            }

            onResume()
          }}
          onMouseDown={event => event.button === 1 && event.preventDefault()}
        >
          {reorderable ? (
            <SidebarRowGrab
              ariaLabel={handleLabel}
              dragging={dragging}
              dragHandleProps={dragHandleProps}
              leadClassName={needsInput ? 'overflow-visible' : undefined}
            >
              <SessionRowLeadDot
                branchStem={branchStem}
                className="transition-opacity group-hover/handle:opacity-0 group-focus-within/handle:opacity-0"
                dotState={dotState}
                projectColor={projectColor}
              />
            </SidebarRowGrab>
          ) : (
            <SidebarRowLead className={needsInput ? 'overflow-visible' : 'overflow-hidden'}>
              <SessionRowLeadDot branchStem={branchStem} dotState={dotState} projectColor={projectColor} />
            </SidebarRowLead>
          )}
          {handoffSource && handoffLabel ? (
            <Tip label={r.handoffOrigin(handoffLabel)}>
              <PlatformAvatar
                className="size-4 rounded-[4px] text-[0.5rem] [&_svg]:size-2.5"
                platformId={handoffSource}
                platformName={handoffLabel}
              />
            </Tip>
          ) : null}
          <SidebarRowLabel className="flex-1 font-normal group-hover:text-foreground group-data-[working=true]:text-foreground/90">
            {title}
          </SidebarRowLabel>
          {showProfile && <ProfileTag profile={session.profile} />}
        </SidebarRowBody>
      </SidebarRowShell>
    </SessionContextMenu>
  )
}

function SessionRowLeadDot({
  branchStem,
  dotState = 'idle',
  className,
  projectColor
}: {
  branchStem?: string
  dotState?: SessionDotState
  className?: string
  projectColor?: null | string
}) {
  return (
    <span className={cn('flex items-center gap-0.5', className)}>
      {branchStem ? (
        <span aria-hidden className="shrink-0 font-mono text-[0.625rem] leading-none text-(--ui-text-quaternary)">
          {branchStem}
        </span>
      ) : null}
      <SidebarRowDot dotState={dotState} projectColor={projectColor} />
    </span>
  )
}

// A pure lookup table: each state maps to its className, aria-label, and
// title. No priority resolution here — the call site already picked one.
// Label/title are resolved from sidebar.row translations, keyed by name.
type DotVariant = {
  ariaLabel?: (r: Translations['sidebar']['row']) => string
  className: string
  role?: 'status'
  title?: (r: Translations['sidebar']['row']) => string
}

// Shared base for every active dot; idle is smaller and uses its own class.
const DOT_BASE = 'relative size-1.5 rounded-full'

// Pseudo-element ping ring that scales outward and fades — shared scaffold for
// the two pulsing dots. The `before:bg-*` color is written inline per variant
// (NOT interpolated here): Tailwind only generates utilities it can see as
// complete static strings, so a `before:bg-${color}` template never emits.
const PING = "before:absolute before:inset-0 before:animate-ping before:rounded-full before:content-['']"

const DOT_VARIANTS: Record<SessionDotState, DotVariant> = {
  // Amber steady — a clarify/approval is blocking the turn. Steady (not
  // pulsing) reads as "your turn", distinct from the accent pulse of a turn.
  'needs-input': {
    ariaLabel: r => r.needsInput,
    className: `${DOT_BASE} quest-glow bg-amber-500`,
    role: 'status',
    title: r => r.waitingForAnswer
  },
  // Accent pulse — the LLM turn is actively running.
  working: {
    ariaLabel: r => r.sessionRunning,
    className: `${DOT_BASE} bg-(--ui-accent) shadow-[0_0_0.625rem_color-mix(in_srgb,var(--ui-accent)_55%,transparent)] ${PING} before:bg-(--ui-accent) before:opacity-70`,
    role: 'status'
  },
  // Quiet accent pulse — the turn is still authoritative-running, but no
  // stream activity has arrived for the watchdog window.
  stalled: {
    ariaLabel: r => r.sessionRunning,
    className: `${DOT_BASE} bg-(--ui-accent) opacity-70 ${PING} before:bg-(--ui-accent) before:opacity-40`,
    role: 'status',
    title: r => r.sessionRunning
  },
  // Pulsing gray — a terminal(background=true) process is alive while the LLM
  // is idle. Gray (not accent) reads as "something chugging along". Brighter
  // than muted-foreground so it's visible against the sidebar surface.
  background: {
    ariaLabel: r => r.backgroundRunning,
    className: `${DOT_BASE} bg-muted-foreground/80 ${PING} before:bg-muted-foreground/80 before:opacity-60`,
    role: 'status',
    title: r => r.backgroundRunning
  },
  // Steady green — a background session's turn completed and the user hasn't
  // opened it since. "Something new here, go look."
  unread: {
    ariaLabel: r => r.finishedUnread,
    className: `${DOT_BASE} bg-emerald-500`,
    role: 'status',
    title: r => r.finishedUnread
  },
  idle: {
    className: 'size-1 rounded-full bg-(--ui-text-quaternary) opacity-80'
  }
}

function SidebarRowDot({
  dotState,
  className,
  projectColor
}: {
  dotState: SessionDotState
  className?: string
  projectColor?: null | string
}) {
  const { t } = useI18n()
  const r = t.sidebar.row

  // An idle session inherits its project's color (a quiet marker matching the
  // project row's own color dot). The active states (working / needs-input /
  // background / unread) own the dot and keep their semantic color, so the
  // inherited tint never competes with an attention cue.
  if (dotState === 'idle' && projectColor) {
    return (
      <span
        aria-hidden="true"
        className={cn('size-1 rounded-full', className)}
        style={{ backgroundColor: projectColor }}
      />
    )
  }

  const variant = DOT_VARIANTS[dotState]

  return (
    <span
      aria-label={variant.ariaLabel?.(r)}
      className={cn(variant.className, className)}
      role={variant.role}
      title={variant.title?.(r)}
    />
  )
}
