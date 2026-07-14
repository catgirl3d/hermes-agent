import { useCallback, useRef } from 'react'

import type { HermesGateway } from '@/hermes'

export type ComposerIntent = 'attachment' | 'text' | 'voice'

interface UseComposerIntentPrewarmOptions {
  gateway: HermesGateway | null
  sessionId: string | null
}

/** Starts at most one best-effort prewarm request per live runtime session. */
export function useComposerIntentPrewarm({ gateway, sessionId }: UseComposerIntentPrewarmOptions) {
  const requestedRef = useRef<{ gateway: HermesGateway; sessionId: string } | null>(null)

  return useCallback(
    (intent: ComposerIntent) => {
      if (!gateway || !sessionId) {
        return
      }

      const requested = requestedRef.current

      if (requested?.gateway === gateway && requested.sessionId === sessionId) {
        return
      }

      const request = { gateway, sessionId }

      requestedRef.current = request
      void gateway.request('session.prewarm', { intent, session_id: sessionId }).catch(() => {
        if (requestedRef.current === request) {
          requestedRef.current = null
        }
      })
    },
    [gateway, sessionId]
  )
}
