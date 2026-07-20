import { JsonRpcGatewayError } from '@hermes/shared'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

import type { ToolResultPruneResponse } from '../../types'

import { renameSessionPreferringRpc, SessionActionsMenu, SessionContextMenu } from './session-actions-menu'

// The branched-session rename bug: a freshly branched session lives only in the
// gateway's runtime _sessions map (no state.db row yet), so REST PATCH
// /api/sessions/{id} 404s with "Session not found". renameSessionPreferringRpc
// must route the ACTIVE row through the session.title RPC (runtime id), which
// persists the row on demand, and otherwise fall back to REST.

const renameSession = vi.fn(async () => ({ ok: true, title: 'rest-title' }))
const request = vi.fn(async () => ({ title: 'rpc-title' }) as never)
const activeGateway = vi.fn<() => { request: typeof request } | null>(() => ({ request }))

vi.mock('@/hermes', () => ({
  renameSession: (...args: unknown[]) => renameSession(...(args as [])),
  // profile.ts calls this at import (its $activeGatewayProfile subscribe fires
  // immediately), pulled in transitively via session-states.
  setApiRequestProfile: () => {},
  HermesGateway: class {}
}))

vi.mock('@/store/gateway', () => ({
  activeGateway: () => activeGateway()
}))

const RUNTIME_ID = 'rt-runtime-1'
const STORED_ID = 'stored-branch-1'

function prunePreview(
  overrides: Partial<ToolResultPruneResponse> = {}
): ToolResultPruneResponse {
  return {
    after_bytes: 400,
    after_tokens: 100,
    applied: false,
    before_bytes: 1_000,
    before_tokens: 250,
    changed: true,
    duplicate_results: 0,
    excerpted_results: 1,
    history_version: 7,
    protected_messages: 10,
    protected_turns: 5,
    pruned_results: 2,
    saved_bytes: 600,
    saved_tokens: 150,
    selected_tool_names: ['terminal'],
    selection_hash: 'terminal',
    session_id: RUNTIME_ID,
    status: 'preview',
    tools: [
      {
        argument_count: 0,
        compact_kind: 'terminal_tail',
        default_selected: true,
        estimated_saved_tokens: 150,
        name: 'terminal',
        result_count: 2,
        selected: true
      }
    ],
    truncated_tool_calls: 0,
    ...overrides
  }
}

afterEach(() => {
  cleanup()
  renameSession.mockClear()
  request.mockClear()
  activeGateway.mockReset()
  activeGateway.mockReturnValue({ request })
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $sessionTiles.set([])
})

describe('renameSessionPreferringRpc', () => {
  it('renames the active branched session via the session.title RPC, not REST', async () => {
    $selectedStoredSessionId.set(STORED_ID)
    $activeSessionId.set(RUNTIME_ID)

    const result = await renameSessionPreferringRpc(STORED_ID, 'My branch')

    expect(request).toHaveBeenCalledWith('session.title', { session_id: RUNTIME_ID, title: 'My branch' })
    expect(renameSession).not.toHaveBeenCalled()
    expect(result.title).toBe('rpc-title')
  })

  it('falls back to REST when the RPC fails (e.g. socket mid-reconnect)', async () => {
    $selectedStoredSessionId.set(STORED_ID)
    $activeSessionId.set(RUNTIME_ID)
    request.mockRejectedValueOnce(new Error('not connected'))

    const result = await renameSessionPreferringRpc(STORED_ID, 'My branch', 'work')

    expect(request).toHaveBeenCalledOnce()
    expect(renameSession).toHaveBeenCalledWith(STORED_ID, 'My branch', 'work')
    expect(result.title).toBe('rest-title')
  })

  it('uses REST for a non-active row (background/persisted session)', async () => {
    $selectedStoredSessionId.set('some-other-active-session')
    $activeSessionId.set(RUNTIME_ID)

    await renameSessionPreferringRpc(STORED_ID, 'My branch', 'work')

    expect(request).not.toHaveBeenCalled()
    expect(renameSession).toHaveBeenCalledWith(STORED_ID, 'My branch', 'work')
  })

  it('uses REST when clearing the title (RPC rejects empty titles)', async () => {
    $selectedStoredSessionId.set(STORED_ID)
    $activeSessionId.set(RUNTIME_ID)

    await renameSessionPreferringRpc(STORED_ID, '')

    expect(request).not.toHaveBeenCalled()
    expect(renameSession).toHaveBeenCalledWith(STORED_ID, '', undefined)
  })

  it('uses REST when no gateway is connected', async () => {
    $selectedStoredSessionId.set(STORED_ID)
    $activeSessionId.set(RUNTIME_ID)
    activeGateway.mockReturnValue(null)

    await renameSessionPreferringRpc(STORED_ID, 'My branch')

    expect(request).not.toHaveBeenCalled()
    expect(renameSession).toHaveBeenCalledWith(STORED_ID, 'My branch', undefined)
  })
})

describe('SessionActionsMenu tool-result pruning', () => {
  it('closes the preview with the cross without applying the cleanup', async () => {
    const preview = prunePreview()
    const onPreview = vi.fn(async () => preview)
    const onApply = vi.fn(async () => ({ ...preview, applied: true, status: 'pruned' as const }))

    render(
      createElement(SessionActionsMenu, {
        children: createElement('button', { type: 'button' }, 'Session actions'),
        onApplyToolResultPrune: onApply,
        onPreviewToolResultPrune: onPreview,
        sessionId: STORED_ID,
        title: 'Target session'
      })
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Session actions' }), {
      button: 0,
      ctrlKey: false
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clean tool outputs' }))
    await screen.findByText('Clean tool outputs?')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByText('Clean tool outputs?')).toBeNull())
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows the backend preview and only applies after confirmation', async () => {
    const preview = {
      after_bytes: 400,
      after_tokens: 100,
      applied: false,
      before_bytes: 1_000,
      before_tokens: 250,
      changed: true,
      duplicate_results: 1,
      excerpted_results: 1,
      history_version: 7,
      protected_messages: 10,
      protected_turns: 5,
      pruned_results: 2,
      saved_bytes: 600,
      saved_tokens: 150,
      selected_tool_names: ['terminal'],
      selection_hash: 'terminal',
      session_id: RUNTIME_ID,
      status: 'preview' as const,
      tools: [
        {
          argument_count: 0,
          compact_kind: 'file_structure' as const,
          default_selected: false,
          estimated_saved_tokens: 80,
          name: 'read_file',
          result_count: 1,
          selected: false
        },
        {
          argument_count: 0,
          compact_kind: 'terminal_tail' as const,
          default_selected: true,
          estimated_saved_tokens: 150,
          name: 'terminal',
          result_count: 2,
          selected: true
        }
      ],
      truncated_tool_calls: 0
    }

    let latestPreview = preview

    const onPreview = vi.fn(async (toolNames?: string[]) => {
      const selected = toolNames ?? ['terminal']
      latestPreview = {
        ...preview,
        selected_tool_names: selected,
        selection_hash: selected.join(','),
        tools: preview.tools.map(tool => ({ ...tool, selected: selected.includes(tool.name) }))
      }

      return latestPreview
    })

    const onApply = vi.fn(async () => ({ ...preview, applied: true, status: 'pruned' as const }))

    render(
      createElement(
        SessionActionsMenu,
        {
          children: createElement('button', { type: 'button' }, 'Session actions'),
          onApplyToolResultPrune: onApply,
          onPreviewToolResultPrune: onPreview,
          sessionId: STORED_ID,
          title: 'Target session'
        }
      )
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Session actions' }), {
      button: 0,
      ctrlKey: false
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clean tool outputs' }))

    expect(onPreview).toHaveBeenCalledOnce()
    const dialogTitle = await screen.findByText('Clean tool outputs?')
    const dialog = dialogTitle.closest('[data-slot="dialog-content"]')

    expect(dialog?.className).toContain('flex')
    expect(dialog?.className).toContain('min-h-[20rem]')
    expect(screen.getByText(/compact 2 old result.*0 call payload/)).toBeTruthy()
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Compact terminal outputs' }).getAttribute('data-state')).toBe(
      'checked'
    )
    expect(screen.getByRole('checkbox', { name: 'Compact read_file outputs' }).getAttribute('data-state')).toBe(
      'unchecked'
    )
    expect(screen.queryByText(/file\/code compaction is lossy/i)).toBeNull()

    const readFileCheckbox = screen.getByRole('checkbox', { name: 'Compact read_file outputs' })

    fireEvent.keyDown(readFileCheckbox, { key: ' ' })
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.click(readFileCheckbox)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Compact terminal outputs' }))
    await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith(['read_file']))
    expect(onPreview).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(/file\/code compaction is lossy/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clean context' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(latestPreview))
  })

  it('refreshes a stale 4090 preview and requires a second confirmation', async () => {
    const initial = prunePreview()

    const refreshed = prunePreview({
      history_version: 8,
      saved_tokens: 90,
      selection_hash: 'terminal-refreshed'
    })

    let previewRequests = 0
    let applyAttempts = 0

    const onPreview = vi.fn(async () => {
      previewRequests += 1

      return previewRequests === 1 ? initial : refreshed
    })

    const onApply = vi.fn(async () => {
      applyAttempts += 1

      if (applyAttempts === 1) {
        throw new JsonRpcGatewayError('history changed after preview', 4090)
      }

      return { ...refreshed, applied: true, status: 'pruned' as const }
    })

    render(
      createElement(SessionActionsMenu, {
        children: createElement('button', { type: 'button' }, 'Session actions'),
        onApplyToolResultPrune: onApply,
        onPreviewToolResultPrune: onPreview,
        sessionId: STORED_ID,
        title: 'Target session'
      })
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Session actions' }), {
      button: 0,
      ctrlKey: false
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clean tool outputs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Clean context' }))

    expect(await screen.findByText(/session changed.*confirm again/i)).toBeTruthy()
    expect(onPreview).toHaveBeenNthCalledWith(2, ['terminal'])
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/saving about 90 tokens/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clean context' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2))
  })

  it('shows non-conflict apply failures inline and keeps the dialog open', async () => {
    const preview = prunePreview()
    const onPreview = vi.fn(async () => preview)

    const onApply = vi.fn(async () => {
      throw new Error('database unavailable')
    })

    render(
      createElement(SessionActionsMenu, {
        children: createElement('button', { type: 'button' }, 'Session actions'),
        onApplyToolResultPrune: onApply,
        onPreviewToolResultPrune: onPreview,
        sessionId: STORED_ID,
        title: 'Target session'
      })
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Session actions' }), {
      button: 0,
      ctrlKey: false
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clean tool outputs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Clean context' }))

    expect(await screen.findByText('database unavailable')).toBeTruthy()
    expect(screen.getByText('Clean tool outputs?')).toBeTruthy()
  })

  it('drops an initial preview that resolves after navigating away and back', async () => {
    let resolvePreview: (value: unknown) => void = () => undefined

    const onPreview = vi.fn(
      () =>
        new Promise(resolve => {
          resolvePreview = resolve
        }) as never
    )

    const onApply = vi.fn(async (value: ToolResultPruneResponse) => value)

    const renderMenu = (sessionId: string) =>
      createElement(
        SessionActionsMenu,
        {
          children: createElement('button', { type: 'button' }, 'Session actions'),
          onApplyToolResultPrune: onApply,
          onPreviewToolResultPrune: onPreview,
          sessionId,
          title: 'Target session'
        }
      )

    const view = render(renderMenu(STORED_ID))

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Session actions' }), {
      button: 0,
      ctrlKey: false
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clean tool outputs' }))
    view.rerender(renderMenu('stored-b'))
    view.rerender(renderMenu(STORED_ID))

    await act(async () => {
      resolvePreview({
        applied: false,
        changed: false,
        history_version: 1,
        protected_messages: 0,
        protected_turns: 5,
        selected_tool_names: [],
        selection_hash: 'empty',
        session_id: RUNTIME_ID,
        status: 'preview',
        tools: []
      })
    })

    expect(screen.queryByText('Clean tool outputs?')).toBeNull()
  })
})

describe('SessionContextMenu tab state', () => {
  it('removes Open in new tab when the session becomes a tile while the menu is open', async () => {
    render(
      createElement(SessionContextMenu, {
        children: createElement('button', { type: 'button' }, 'Session row'),
        sessionId: STORED_ID,
        title: 'Target session'
      })
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Session row' }))
    expect(await screen.findByRole('menuitem', { name: 'Open in new tab' })).toBeTruthy()

    act(() => {
      $sessionTiles.set([{ storedSessionId: STORED_ID }])
    })

    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Open in new tab' })).toBeNull())
  })
})
