import { isJsonRpcGatewayError } from '@hermes/shared'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Codicon } from '@/components/ui/codicon'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { renameSession } from '@/hermes'
import { useI18n } from '@/i18n'
import { compactNumber } from '@/lib/format'
import { triggerHaptic } from '@/lib/haptics'
import { exportSession } from '@/lib/session-export'
import { activeGateway } from '@/store/gateway'
import { notify, notifyError } from '@/store/notifications'
import { $activeSessionId, $selectedStoredSessionId, setSessions } from '@/store/session'
import { canOpenSessionWindow, openSessionInNewWindow } from '@/store/windows'

import type { SessionTitleResponse } from '../../types'
import type { ToolResultPruneResponse } from '../../types'

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
  onApplyToolResultPrune?: (preview: ToolResultPruneResponse) => Promise<ToolResultPruneResponse>
  onPreviewToolResultPrune?: (toolNames?: string[]) => Promise<ToolResultPruneResponse>
}

type MenuItem = typeof DropdownMenuItem | typeof ContextMenuItem

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

  const pinItem: ItemSpec = {
    disabled: !onPin,
    icon: 'pin',
    label: pinned ? r.unpin : r.pin,
    onSelect: () => {
      triggerHaptic('selection')
      onPin?.()
    }
  }

  const items: ItemSpec[] = [
    ...(canOpenSessionWindow()
      ? [
          {
            disabled: !sessionId,
            icon: 'link-external',
            label: r.newWindow,
            onSelect: () => {
              triggerHaptic('selection')
              void openSessionInNewWindow(sessionId)
            }
          }
        ]
      : []),
    {
      disabled: !sessionId,
      icon: 'cloud-download',
      label: r.export,
      onSelect: () => {
        triggerHaptic('selection')
        void exportSession(sessionId, { profile, title })
      }
    },
    {
      disabled: !onBranch,
      icon: 'git-branch',
      label: r.branchFrom,
      onSelect: () => {
        triggerHaptic('selection')
        onBranch?.()
      }
    },
    {
      disabled: !sessionId,
      icon: 'edit',
      label: r.rename,
      onSelect: () => {
        triggerHaptic('selection')
        setRenameOpen(true)
      }
    },
    ...(onPreviewToolResultPrune && onApplyToolResultPrune
      ? [
          {
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
                  if (
                    prunePreviewRequestRef.current === requestId &&
                    sessionIdRef.current === requestedSessionId
                  ) {
                    setPrunePreview(preview)
                    setSelectedToolNames(new Set(preview.selected_tool_names))
                  }
                })
                .catch(err => notifyError(err, r.cleanToolOutputsFailed))
            }
          }
        ]
      : []),
    {
      disabled: !onArchive,
      icon: 'archive',
      label: r.archive,
      onSelect: () => {
        triggerHaptic('selection')
        onArchive?.()
      }
    },
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

  const renderItems = (Item: MenuItem) => (
    <>
      {renderMenuItem(Item, pinItem)}
      <CopyButton
        appearance={Item === DropdownMenuItem ? 'menu-item' : 'context-menu-item'}
        disabled={!sessionId}
        errorMessage={r.copyIdFailed}
        iconClassName="size-3.5 text-current"
        key={r.copyId}
        label={r.copyId}
        onCopyError={err => notifyError(err, r.copyIdFailed)}
        text={sessionId}
      />
      {items.map(spec => renderMenuItem(Item, spec))}
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          aria-label={t.sidebar.row.actionsFor(actions.title)}
          className="w-40"
          sideOffset={sideOffset}
        >
          {renderItems(DropdownMenuItem)}
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
          {renderItems(ContextMenuItem)}
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
