import { isJsonRpcGatewayError } from '@hermes/shared'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  closeAllTreeTabs,
  closeOtherTreeTabs,
  closeTreeTabsToRight,
  treeTabCloseTargets
} from '@/components/pane-shell/tree/store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Codicon } from '@/components/ui/codicon'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { renameSession } from '@/hermes'
import { useI18n } from '@/i18n'
import { compactNumber } from '@/lib/format'
import { triggerHaptic } from '@/lib/haptics'
import { exportSession } from '@/lib/session-export'
import { activeGateway } from '@/store/gateway'
import { notify, notifyError } from '@/store/notifications'
import { $activeSessionId, $selectedStoredSessionId, setSessions } from '@/store/session'
import { $sessionTiles, openSessionTile } from '@/store/session-states'
import { canOpenSessionWindow, openSessionInNewWindow } from '@/store/windows'

import type { SessionTitleResponse, ToolResultPruneResponse } from '../../types'

// Rename a session, preferring the gateway's session.title RPC over REST.
//
// A freshly *branched* session (and any brand-new chat) lives only in the
// gateway's in-memory _sessions map keyed by its RUNTIME id — no row is
// persisted to state.db until the first turn. REST PATCH /api/sessions/{id}
// resolves against the stored sessions table, so it 404s ("Session not found")
// on these runtime-only sessions. The session.title RPC resolves the live
// runtime session AND persists the row on demand, so it succeeds where REST
// cannot. This mirrors the /title slash command's fix (use-prompt-actions.ts).
//
// We only take the RPC path for the ACTIVE/selected session: its runtime id is
// known ($activeSessionId) and it lives on the active gateway, so there is no
// profile-routing ambiguity. Every other row (already persisted, possibly on a
// background profile) keeps the REST path, which handles profile scoping and a
// non-empty title is required by the RPC (it rejects clears), so clears stay on
// REST too.
export async function renameSessionPreferringRpc(
  storedSessionId: string,
  title: string,
  profile?: string
): Promise<{ title?: string }> {
  const isActiveRow = storedSessionId === $selectedStoredSessionId.get()
  const runtimeId = isActiveRow ? $activeSessionId.get() : null
  const gateway = activeGateway()

  if (title && runtimeId && gateway) {
    try {
      const result = await gateway.request<SessionTitleResponse>('session.title', {
        session_id: runtimeId,
        title
      })

      return { title: result?.title ?? title }
    } catch (err) {
      // Fall through to REST — e.g. the socket is mid-reconnect. REST still
      // works for any session that already has a persisted row. Log so a
      // genuine RPC-side failure (which then surfaces a REST 404 for the
      // runtime id) is at least diagnosable instead of silently swallowed.
      console.warn('session.title RPC rename failed; falling back to REST', err)
    }
  }

  return renameSession(storedSessionId, title, profile)
}

interface SessionActions {
  sessionId: string
  title: string
  pinned?: boolean
  profile?: string
  onPin?: () => void
  onBranch?: () => void
  onArchive?: () => void
  onDelete?: () => void
  /** Close this surface (a tile tab) — omitted where nothing closes (sidebar
   *  rows, the main tab). */
  onClose?: () => void
  /** TAB surfaces: the session is already a tab, so "Open in new tab" is
   *  nonsense there — sidebar rows/dropdowns keep it. */
  surface?: 'row' | 'tab'
  /** The tab's layout-tree pane id (`session-tile:<id>` or `workspace`) — enables
   *  the Close-others / to-the-right / all tab verbs. Tab surfaces only. */
  tabPaneId?: string
  /** The MAIN tab's escape hatch: hide the zone's tab bar (it sticky-shows
   *  once a tab is ever gained; this is the explicit off switch). */
  onHideTabBar?: () => void
  onApplyToolResultPrune?: (preview: ToolResultPruneResponse) => Promise<ToolResultPruneResponse>
  onPreviewToolResultPrune?: (toolNames?: string[]) => Promise<ToolResultPruneResponse>
}

type MenuItem = typeof DropdownMenuItem | typeof ContextMenuItem

/** A menu flavour (dropdown / context) — item + separator components. */
interface MenuKit {
  Item: MenuItem
  Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator
}

const DROPDOWN_KIT: MenuKit = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator }
const CONTEXT_KIT: MenuKit = { Item: ContextMenuItem, Separator: ContextMenuSeparator }
const PRUNE_PREVIEW_DEBOUNCE_MS = 200

interface ItemSpec {
  className?: string
  disabled: boolean
  icon: string
  label: string
  onSelect: (event: Event) => void
  variant?: 'destructive'
}

function useSessionActions({
  sessionId,
  title,
  pinned = false,
  profile,
  onPin,
  onBranch,
  onArchive,
  onDelete,
  onClose,
  onHideTabBar,
  surface = 'row',
  tabPaneId,
  onApplyToolResultPrune,
  onPreviewToolResultPrune
}: SessionActions) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const [renameOpen, setRenameOpen] = useState(false)
  const [prunePreview, setPrunePreview] = useState<ToolResultPruneResponse | null>(null)
  const [prunePreviewError, setPrunePreviewError] = useState<string | null>(null)
  const [prunePreviewLoading, setPrunePreviewLoading] = useState(false)
  const [selectedToolNames, setSelectedToolNames] = useState<Set<string>>(new Set())
  const prunePreviewRequestRef = useRef(0)
  const prunePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  useEffect(() => {
    if (prunePreviewTimerRef.current) {
      clearTimeout(prunePreviewTimerRef.current)
      prunePreviewTimerRef.current = null
    }

    prunePreviewRequestRef.current += 1
    setPrunePreview(null)
    setPrunePreviewError(null)
    setPrunePreviewLoading(false)
    setSelectedToolNames(new Set())

    return () => {
      if (prunePreviewTimerRef.current) {
        clearTimeout(prunePreviewTimerRef.current)
        prunePreviewTimerRef.current = null
      }
    }
  }, [sessionId])

  // Already showing as a tab somewhere (a tile, or loaded in main — main IS
  // a tab): offering "Open in new tab" again is noise.
  const alreadyTabbed =
    sessionId === $selectedStoredSessionId.get() || $sessionTiles.get().some(tile => tile.storedSessionId === sessionId)

  const spec = (partial: Omit<ItemSpec, 'onSelect'> & { onSelect: () => void }): ItemSpec => partial

  // OPEN — where else this session can go. A tab surface IS a tab already,
  // so it only offers the window hop (and its own Close, below).
  const openItems: ItemSpec[] = [
    ...(surface === 'row' && !alreadyTabbed
      ? [
          spec({
            disabled: !sessionId,
            icon: 'browser',
            label: r.openInNewTab,
            onSelect: () => {
              triggerHaptic('selection')
              // Stack into the MAIN zone as a tab (center dock; the strip
              // sticky-shows on gain) — the door to the tab bar.
              openSessionTile(sessionId, 'center')
            }
          })
        ]
      : []),
    ...(canOpenSessionWindow()
      ? [
          spec({
            disabled: !sessionId,
            icon: 'link-external',
            label: r.newWindow,
            onSelect: () => {
              triggerHaptic('selection')
              void openSessionInNewWindow(sessionId)
            }
          })
        ]
      : [])
  ]

  // IDENTITY — name/mark/reference the session.
  const identityItems: ItemSpec[] = [
    spec({
      disabled: !sessionId,
      icon: 'edit',
      label: r.rename,
      onSelect: () => {
        triggerHaptic('selection')
        setRenameOpen(true)
      }
    }),
    spec({
      disabled: !onPin,
      icon: 'pin',
      label: pinned ? r.unpin : r.pin,
      onSelect: () => {
        triggerHaptic('selection')
        onPin?.()
      }
    })
  ]

  // WORK — derive/extract from the session.
  const workItems: ItemSpec[] = [
    spec({
      disabled: !onBranch,
      icon: 'git-branch',
      label: r.branchFrom,
      onSelect: () => {
        triggerHaptic('selection')
        onBranch?.()
      }
    }),
    spec({
      disabled: !sessionId,
      icon: 'cloud-download',
      label: r.export,
      onSelect: () => {
        triggerHaptic('selection')
        void exportSession(sessionId, { profile, title })
      }
    }),
    ...(onPreviewToolResultPrune && onApplyToolResultPrune
      ? [
          spec({
            disabled: !sessionId,
            icon: 'clear-all',
            label: r.cleanToolOutputs,
            onSelect: () => {
              const requestedSessionId = sessionId
              const requestId = prunePreviewRequestRef.current + 1
              prunePreviewRequestRef.current = requestId

              triggerHaptic('selection')
              void onPreviewToolResultPrune()
                .then(preview => {
                  if (prunePreviewRequestRef.current === requestId && sessionIdRef.current === requestedSessionId) {
                    setPrunePreview(preview)
                    setSelectedToolNames(new Set(preview.selected_tool_names))
                  }
                })
                .catch(err => notifyError(err, r.cleanToolOutputsFailed))
            }
          })
        ]
      : [])
  ]

  // TAB — close verbs that act on the strip (tabs only; a row isn't a tab).
  const closeTargets = surface === 'tab' && tabPaneId ? treeTabCloseTargets(tabPaneId) : null

  const tabCloseItems: ItemSpec[] =
    surface === 'tab'
      ? [
          ...(onClose
            ? [
                spec({
                  disabled: false,
                  icon: 'close',
                  label: t.common.close,
                  onSelect: () => {
                    triggerHaptic('selection')
                    onClose()
                  }
                })
              ]
            : []),
          ...(tabPaneId
            ? [
                spec({
                  disabled: !closeTargets?.others,
                  icon: 'close-all',
                  label: t.zones.closeOthers,
                  onSelect: () => {
                    triggerHaptic('selection')
                    closeOtherTreeTabs(tabPaneId)
                  }
                }),
                spec({
                  disabled: !closeTargets?.right,
                  icon: 'arrow-right',
                  label: t.zones.closeToRight,
                  onSelect: () => {
                    triggerHaptic('selection')
                    closeTreeTabsToRight(tabPaneId)
                  }
                }),
                spec({
                  disabled: !closeTargets?.all,
                  icon: 'clear-all',
                  label: t.zones.closeAll,
                  onSelect: () => {
                    triggerHaptic('selection')
                    closeAllTreeTabs(tabPaneId)
                  }
                })
              ]
            : [])
        ]
      : []

  // DANGER — put it away / destroy it (delete stays last, destructive-red).
  const dangerItems: ItemSpec[] = [
    spec({
      disabled: !onArchive,
      icon: 'archive',
      label: r.archive,
      onSelect: () => {
        triggerHaptic('selection')
        onArchive?.()
      }
    }),
    {
      className: 'text-destructive focus:text-destructive',
      disabled: !onDelete,
      icon: 'trash',
      label: t.common.delete,
      onSelect: () => {
        triggerHaptic('warning')
        onDelete?.()
      },
      variant: 'destructive'
    }
  ]

  const renderMenuItem = (Item: MenuItem, { className, disabled, icon, label, onSelect, variant }: ItemSpec) => (
    <Item className={className} disabled={disabled} key={label} onSelect={onSelect} variant={variant}>
      <Codicon name={icon} size="0.875rem" />
      <span>{label}</span>
    </Item>
  )

  const renderItems = (kit: MenuKit) => (
    <>
      {openItems.map(item => renderMenuItem(kit.Item, item))}
      {openItems.length > 0 && <kit.Separator />}
      {identityItems.map(item => renderMenuItem(kit.Item, item))}
      <CopyButton
        appearance={kit.Item === DropdownMenuItem ? 'menu-item' : 'context-menu-item'}
        disabled={!sessionId}
        errorMessage={r.copyIdFailed}
        iconClassName="size-3.5 text-current"
        key={r.copyId}
        label={r.copyId}
        onCopyError={err => notifyError(err, r.copyIdFailed)}
        text={sessionId}
      />
      <kit.Separator />
      {workItems.map(item => renderMenuItem(kit.Item, item))}
      {tabCloseItems.length > 0 && (
        <>
          <kit.Separator />
          {tabCloseItems.map(item => renderMenuItem(kit.Item, item))}
        </>
      )}
      <kit.Separator />
      {dangerItems.map(item => renderMenuItem(kit.Item, item))}
      {onHideTabBar && (
        <>
          <kit.Separator />
          {renderMenuItem(kit.Item, {
            disabled: false,
            icon: 'eye-closed',
            label: r.hideTabBar,
            onSelect: () => {
              triggerHaptic('selection')
              onHideTabBar()
            }
          })}
        </>
      )}
    </>
  )

  const renameDialog = (
    <RenameSessionDialog
      currentTitle={title}
      onOpenChange={setRenameOpen}
      open={renameOpen}
      profile={profile}
      sessionId={sessionId}
    />
  )

  const pruneDialog = (
    <ConfirmDialog
      confirmDisabled={
        prunePreviewLoading ||
        Boolean(prunePreviewError) ||
        selectedToolNames.size === 0 ||
        !prunePreview?.changed
      }
      confirmFromDialogKeyDown={false}
      confirmLabel={prunePreview?.changed ? r.cleanToolOutputsConfirm : t.common.done}
      contentClassName="flex min-h-[20rem] flex-col"
      description={
        prunePreview ? (
          <span className="grid gap-2 text-left">
            <span>
              {prunePreview.changed
                ? r.cleanToolOutputsPreview(
                    prunePreview.pruned_results,
                    prunePreview.truncated_tool_calls,
                    compactNumber(prunePreview.saved_tokens)
                  )
                : r.cleanToolOutputsNoop}
            </span>
            <span>{r.cleanToolOutputsProtected(prunePreview.protected_turns)}</span>
            {prunePreview.tools.some(
              tool => tool.compact_kind === 'file_structure' && selectedToolNames.has(tool.name)
            ) ? (
              <span className="font-medium text-destructive">{r.cleanToolOutputsCodeWarning}</span>
            ) : null}
            {prunePreview.changed ? <span>{r.cleanToolOutputsWarning}</span> : null}
          </span>
        ) : undefined
      }
      destructive={Boolean(prunePreview?.changed)}
      doneLabel={r.cleanToolOutputsDone}
      onClose={() => {
        if (prunePreviewTimerRef.current) {
          clearTimeout(prunePreviewTimerRef.current)
          prunePreviewTimerRef.current = null
        }

        prunePreviewRequestRef.current += 1
        setPrunePreview(null)
        setPrunePreviewError(null)
        setPrunePreviewLoading(false)
        setSelectedToolNames(new Set())
      }}
      onConfirm={async () => {
        if (!prunePreview?.changed || !onApplyToolResultPrune) {
          return
        }

        try {
          await onApplyToolResultPrune(prunePreview)
        } catch (err) {
          const message = err instanceof Error ? err.message : ''

          const conflict =
            isJsonRpcGatewayError(err, 4090) ||
            /history changed after preview|tool selection changed after preview/i.test(message)

          if (!conflict || !onPreviewToolResultPrune) {
            throw err
          }

          const requestId = prunePreviewRequestRef.current + 1
          prunePreviewRequestRef.current = requestId
          setPrunePreviewLoading(true)
          setPrunePreviewError(null)

          try {
            const refreshed = await onPreviewToolResultPrune([...selectedToolNames].sort())

            if (prunePreviewRequestRef.current === requestId) {
              setPrunePreview(refreshed)
              setSelectedToolNames(new Set(refreshed.selected_tool_names))
            }
          } finally {
            if (prunePreviewRequestRef.current === requestId) {
              setPrunePreviewLoading(false)
            }
          }

          throw new Error(r.cleanToolOutputsStale)
        }
      }}
      open={Boolean(prunePreview)}
      title={r.cleanToolOutputsTitle}
    >
      {prunePreview ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="text-xs font-medium text-(--ui-text-secondary)">{r.cleanToolOutputsChoose}</div>
          <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
            {prunePreview.tools.map(tool => {
              const checked = selectedToolNames.has(tool.name)

              return (
                <label
                  className="flex cursor-pointer items-start gap-2 py-1.5 text-xs hover:text-foreground"
                  key={tool.name}
                >
                  <Checkbox
                    aria-label={r.cleanToolOutputsToggle(tool.name)}
                    checked={checked}
                    onCheckedChange={value => {
                      if (!onPreviewToolResultPrune) {
                        return
                      }

                      const next = new Set(selectedToolNames)

                      if (value === true) {
                        next.add(tool.name)
                      } else {
                        next.delete(tool.name)
                      }

                      const requestId = prunePreviewRequestRef.current + 1
                      prunePreviewRequestRef.current = requestId
                      setSelectedToolNames(next)
                      setPrunePreviewLoading(true)
                      setPrunePreviewError(null)

                      if (prunePreviewTimerRef.current) {
                        clearTimeout(prunePreviewTimerRef.current)
                      }

                      prunePreviewTimerRef.current = setTimeout(() => {
                        prunePreviewTimerRef.current = null
                        void onPreviewToolResultPrune([...next].sort())
                          .then(preview => {
                            if (prunePreviewRequestRef.current === requestId) {
                              setPrunePreview(preview)
                              setSelectedToolNames(new Set(preview.selected_tool_names))
                            }
                          })
                          .catch(err => {
                            if (prunePreviewRequestRef.current === requestId) {
                              setPrunePreviewError(
                                err instanceof Error ? err.message : r.cleanToolOutputsFailed
                              )
                            }
                          })
                          .finally(() => {
                            if (prunePreviewRequestRef.current === requestId) {
                              setPrunePreviewLoading(false)
                            }
                          })
                      }, PRUNE_PREVIEW_DEBOUNCE_MS)
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[0.6875rem]">{tool.name}</span>
                    <span className="block text-(--ui-text-tertiary)">
                      {r.cleanToolOutputsToolMeta(
                        tool.result_count,
                        tool.argument_count,
                        compactNumber(tool.estimated_saved_tokens),
                        r.cleanToolOutputsKinds[tool.compact_kind]
                      )}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          <div
            aria-live="polite"
            className={
              prunePreviewError ? 'min-h-4 text-xs text-destructive' : 'min-h-4 text-xs text-(--ui-text-tertiary)'
            }
          >
            {prunePreviewError ?? (prunePreviewLoading ? r.cleanToolOutputsUpdating : '')}
          </div>
        </div>
      ) : null}
    </ConfirmDialog>
  )

  return { pruneDialog, renameDialog, renderItems }
}

interface SessionActionsMenuProps
  extends SessionActions, Pick<React.ComponentProps<typeof DropdownMenuContent>, 'align' | 'sideOffset'> {
  children: React.ReactNode
}

export function SessionActionsMenu({ children, align = 'end', sideOffset = 6, ...actions }: SessionActionsMenuProps) {
  const { t } = useI18n()
  const { pruneDialog, renameDialog, renderItems } = useSessionActions(actions)
  const [open, setOpen] = useState(false)

  return (
    <>
      <DropdownMenu onOpenChange={setOpen} open={open}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          aria-label={t.sidebar.row.actionsFor(actions.title)}
          className="w-40"
          sideOffset={sideOffset}
        >
          {renderItems(DROPDOWN_KIT)}
        </DropdownMenuContent>
      </DropdownMenu>
      {renameDialog}
      {pruneDialog}
    </>
  )
}

interface SessionContextMenuProps extends SessionActions {
  children: React.ReactNode
}

export function SessionContextMenu({ children, ...actions }: SessionContextMenuProps) {
  const { t } = useI18n()
  const { pruneDialog, renameDialog, renderItems } = useSessionActions(actions)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent aria-label={t.sidebar.row.actionsFor(actions.title)} className="w-40">
          {renderItems(CONTEXT_KIT)}
        </ContextMenuContent>
      </ContextMenu>
      {renameDialog}
      {pruneDialog}
    </>
  )
}

interface RenameSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  currentTitle: string
  profile?: string
}

function RenameSessionDialog({ open, onOpenChange, sessionId, currentTitle, profile }: RenameSessionDialogProps) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const [value, setValue] = useState(currentTitle)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(currentTitle)
      window.setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [currentTitle, open])

  const submit = async () => {
    const next = value.trim()

    if (!sessionId || submitting) {
      return
    }

    if (next === currentTitle.trim()) {
      onOpenChange(false)

      return
    }

    setSubmitting(true)

    try {
      const result = await renameSessionPreferringRpc(sessionId, next, profile)
      const finalTitle = result.title || next || ''
      setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title: finalTitle || null } : s)))
      notify({ durationMs: 2_000, kind: 'success', message: r.renamed })
      onOpenChange(false)
    } catch (err) {
      notifyError(err, r.renameFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{r.renameTitle}</DialogTitle>
          <DialogDescription>{r.renameDesc}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          disabled={submitting}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              onOpenChange(false)
            }
          }}
          placeholder={r.untitledPlaceholder}
          ref={inputRef}
          value={value}
        />
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={submitting} onClick={() => void submit()} type="button">
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
