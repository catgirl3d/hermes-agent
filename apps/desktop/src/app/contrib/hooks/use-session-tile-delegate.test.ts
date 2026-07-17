import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState, ToolResultPruneResponse } from '@/app/types'
import { sessionTileDelegate } from '@/store/session-states'

import type { GatewayRequester } from '../types'

import { useSessionTileDelegate } from './use-session-tile-delegate'

const STORED_SESSION_ID = 'stored-session'
const RUNTIME_SESSION_ID = 'runtime-session'

function sessionState(storedSessionId = STORED_SESSION_ID): ClientSessionState {
  return {
    awaitingResponse: false,
    branch: '',
    busy: false,
    cwd: '',
    fast: false,
    interrupted: false,
    interimBoundaryPending: false,
    messages: [],
    model: '',
    needsInput: false,
    pendingBranchGroup: null,
    personality: '',
    provider: '',
    reasoningEffort: '',
    sawAssistantPayload: false,
    serviceTier: '',
    storedSessionId,
    streamId: null,
    turnStartedAt: null,
    usage: null,
    yolo: false
  }
}

function prunePreview(overrides: Partial<ToolResultPruneResponse> = {}): ToolResultPruneResponse {
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
    pruned_results: 1,
    saved_bytes: 600,
    saved_tokens: 150,
    selected_tool_names: ['terminal'],
    selection_hash: 'terminal',
    session_id: RUNTIME_SESSION_ID,
    status: 'preview',
    tools: [],
    truncated_tool_calls: 0,
    ...overrides
  }
}

function createDelegate(requestGateway: GatewayRequester) {
  const runtimeIdByStoredSessionIdRef = { current: new Map([[STORED_SESSION_ID, RUNTIME_SESSION_ID]]) }
  const sessionStateByRuntimeIdRef = { current: new Map([[RUNTIME_SESSION_ID, sessionState()]]) }

  const updateSessionState = vi.fn((runtimeId: string, updater: (state: ClientSessionState) => ClientSessionState) =>
    updater(sessionStateByRuntimeIdRef.current.get(runtimeId)!)
  )

  renderHook(() =>
    useSessionTileDelegate({
      archiveSession: vi.fn(async () => undefined),
      branchStoredSession: vi.fn(async () => undefined),
      executeSlashCommand: vi.fn() as never,
      removeSession: vi.fn(async () => undefined),
      requestGateway,
      runtimeIdByStoredSessionIdRef,
      sessionStateByRuntimeIdRef,
      updateSessionState
    })
  )

  return {
    delegate: sessionTileDelegate()!,
    runtimeIdByStoredSessionIdRef,
    sessionStateByRuntimeIdRef,
    updateSessionState
  }
}

afterEach(cleanup)

describe('useSessionTileDelegate tool-result pruning', () => {
  it('previews the stored session through its validated runtime binding', async () => {
    const preview = prunePreview()
    const requestGateway = vi.fn(async () => preview) as unknown as GatewayRequester
    const { delegate } = createDelegate(requestGateway)

    await expect(delegate.previewToolResultPrune(STORED_SESSION_ID, ['terminal'])).resolves.toBe(preview)

    expect(requestGateway).toHaveBeenCalledWith('session.prune_tool_results', {
      session_id: RUNTIME_SESSION_ID,
      tool_names: ['terminal']
    })
  })

  it('applies the preview to the same bound runtime and stored cache entry', async () => {
    const preview = prunePreview()

    const requestGateway = vi.fn(async () => ({
      ...preview,
      applied: true,
      messages: [{ content: 'pruned result', role: 'assistant' as const }],
      status: 'pruned' as const
    })) as unknown as GatewayRequester

    const { delegate, updateSessionState } = createDelegate(requestGateway)

    await delegate.applyToolResultPrune(STORED_SESSION_ID, preview)

    expect(requestGateway).toHaveBeenCalledWith('session.prune_tool_results', {
      confirm: true,
      history_version: preview.history_version,
      selection_hash: preview.selection_hash,
      session_id: RUNTIME_SESSION_ID,
      tool_names: preview.selected_tool_names
    })
    expect(updateSessionState).toHaveBeenCalledWith(RUNTIME_SESSION_ID, expect.any(Function), STORED_SESSION_ID)
  })

  it('does not publish a completed prune after the stored session rebinds', async () => {
    const preview = prunePreview()
    let resolveRequest: (value: ToolResultPruneResponse) => void = () => undefined

    const requestGateway = vi.fn(
      () =>
        new Promise<ToolResultPruneResponse>(resolve => {
          resolveRequest = resolve
        })
    ) as unknown as GatewayRequester

    const { delegate, runtimeIdByStoredSessionIdRef, sessionStateByRuntimeIdRef, updateSessionState } =
      createDelegate(requestGateway)

    const applying = delegate.applyToolResultPrune(STORED_SESSION_ID, preview)
    runtimeIdByStoredSessionIdRef.current.set(STORED_SESSION_ID, 'runtime-rebound')
    sessionStateByRuntimeIdRef.current.set('runtime-rebound', sessionState())
    resolveRequest({
      ...preview,
      applied: true,
      messages: [{ content: 'pruned result', role: 'assistant' }],
      status: 'pruned'
    })

    await applying

    expect(updateSessionState).not.toHaveBeenCalled()
  })
})
