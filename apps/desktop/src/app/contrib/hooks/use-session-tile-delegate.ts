import { useEffect } from 'react'

import type { ToolResultPruneResponse } from '@/app/types'
import { getSessionMessages, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS } from '@/hermes'
import { reconcilePrunedChatMessages, toChatMessages } from '@/lib/chat-messages'
import { publishSessionState, setSessionTileDelegate } from '@/store/session-states'
import type { SessionResumeResponse } from '@/types/hermes'

import type { usePromptActions } from '../../session/hooks/use-prompt-actions'
import type { useSessionStateCache } from '../../session/hooks/use-session-state-cache'
import type { GatewayRequester } from '../types'

type SessionStateCache = ReturnType<typeof useSessionStateCache>

interface SessionTileDelegateParams {
  archiveSession: (storedSessionId: string) => Promise<unknown>
  branchStoredSession: (storedSessionId: string) => Promise<unknown>
  executeSlashCommand: ReturnType<typeof usePromptActions>['executeSlashCommand']
  removeSession: (storedSessionId: string) => Promise<unknown>
  requestGateway: GatewayRequester
  runtimeIdByStoredSessionIdRef: SessionStateCache['runtimeIdByStoredSessionIdRef']
  sessionStateByRuntimeIdRef: SessionStateCache['sessionStateByRuntimeIdRef']
  updateSessionState: SessionStateCache['updateSessionState']
}

/**
 * Publishes the session-tile delegate: resume / submit / interrupt / slash for
 * tiled sessions WITHOUT touching the primary view ($activeSessionId /
 * $messages stay the main thread's). Resume reuses a live runtime binding when
 * one exists (incl. the main thread's own session); a cold tile binds +
 * hydrates the cache, which publishSessionState mirrors to the tile.
 */
export function useSessionTileDelegate({
  archiveSession,
  branchStoredSession,
  executeSlashCommand,
  removeSession,
  requestGateway,
  runtimeIdByStoredSessionIdRef,
  sessionStateByRuntimeIdRef,
  updateSessionState
}: SessionTileDelegateParams): void {
  useEffect(() => {
    const runtimeForStoredSession = (storedSessionId: string): string | null => {
      const runtimeId = runtimeIdByStoredSessionIdRef.current.get(storedSessionId)
      const state = runtimeId ? sessionStateByRuntimeIdRef.current.get(runtimeId) : undefined

      return runtimeId && state?.storedSessionId === storedSessionId ? runtimeId : null
    }

    const requireRuntimeForStoredSession = (storedSessionId: string): string => {
      const runtimeId = runtimeForStoredSession(storedSessionId)

      if (!runtimeId) {
        throw new Error('Session is no longer active')
      }

      return runtimeId
    }

    setSessionTileDelegate({
      archiveSession: async storedSessionId => {
        await archiveSession(storedSessionId)
      },
      applyToolResultPrune: async (storedSessionId, preview) => {
        const runtimeId = requireRuntimeForStoredSession(storedSessionId)

        if (preview.session_id !== runtimeId) {
          throw new Error('Session is no longer active')
        }

        const result = await requestGateway<ToolResultPruneResponse>('session.prune_tool_results', {
          session_id: preview.session_id,
          confirm: true,
          history_version: preview.history_version,
          selection_hash: preview.selection_hash,
          tool_names: preview.selected_tool_names
        })

        // Reconnects re-mint runtime IDs. Never publish a late response into a
        // stored session whose runtime binding changed while the RPC was in flight.
        if (runtimeForStoredSession(storedSessionId) !== runtimeId) {
          return result
        }

        if (result.applied && Array.isArray(result.messages)) {
          const backendMessages = toChatMessages(result.messages)

          updateSessionState(
            runtimeId,
            state => ({
              ...state,
              messages: reconcilePrunedChatMessages(
                backendMessages,
                state.messages,
                new Set(result.selected_tool_names)
              )
            }),
            storedSessionId
          )
        }

        return result
      },
      branchSession: async storedSessionId => {
        await branchStoredSession(storedSessionId)
      },
      deleteSession: async storedSessionId => {
        await removeSession(storedSessionId)
      },
      executeSlash: async (rawCommand, sessionId) => {
        await executeSlashCommand(rawCommand, { sessionId })
      },
      interruptSession: async runtimeId => {
        await requestGateway('session.interrupt', { session_id: runtimeId })
      },
      previewToolResultPrune: async (storedSessionId, toolNames) => {
        const runtimeId = requireRuntimeForStoredSession(storedSessionId)

        return requestGateway<ToolResultPruneResponse>('session.prune_tool_results', {
          session_id: runtimeId,
          ...(toolNames !== undefined ? { tool_names: toolNames } : {})
        })
      },
      resumeTile: async storedSessionId => {
        const existing = runtimeIdByStoredSessionIdRef.current.get(storedSessionId)
        const cached = existing ? sessionStateByRuntimeIdRef.current.get(existing) : undefined

        if (existing && cached?.storedSessionId === storedSessionId) {
          publishSessionState(existing, cached)

          return existing
        }

        const [prefetch, resumed] = await Promise.all([
          getSessionMessages(storedSessionId).catch(() => null),
          requestGateway<SessionResumeResponse>('session.resume', { session_id: storedSessionId, cols: 96 })
        ])

        const runtimeId = resumed?.session_id

        if (!runtimeId) {
          throw new Error('resume returned no session id')
        }

        updateSessionState(
          runtimeId,
          state => ({
            ...state,
            busy: Boolean(resumed?.info?.running),
            messages:
              state.messages.length > 0 ? state.messages : toChatMessages(prefetch?.messages ?? resumed?.messages ?? [])
          }),
          storedSessionId
        )

        return runtimeId
      },
      submitToSession: async (runtimeId, text) => {
        await requestGateway('prompt.submit', { session_id: runtimeId, text }, PROMPT_SUBMIT_REQUEST_TIMEOUT_MS)
      },
      updateSession: (runtimeId, updater) => updateSessionState(runtimeId, updater)
    })
  }, [
    archiveSession,
    branchStoredSession,
    executeSlashCommand,
    removeSession,
    requestGateway,
    runtimeIdByStoredSessionIdRef,
    sessionStateByRuntimeIdRef,
    updateSessionState
  ])
}
