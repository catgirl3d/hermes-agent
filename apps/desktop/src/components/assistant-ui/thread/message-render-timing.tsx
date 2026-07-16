import { createContext, type ReactNode, useContext, useInsertionEffect, useLayoutEffect, useMemo, useRef } from 'react'

import {
  activeSessionSwitchTraceRequestId,
  markActiveSessionSwitchTraceForRequest,
  measureRenderCommitPhases
} from '@/lib/session-switch-trace'

type RenderTimingKind = 'assistant-markdown' | 'assistant-message' | 'user-message'

interface MessageRenderTimingScopeValue {
  messageId: string
  traceSessionId: string | null
}

const MessageRenderTimingContext = createContext<MessageRenderTimingScopeValue | null>(null)

export function MessageRenderTimingScope({
  children,
  messageId,
  traceSessionId
}: MessageRenderTimingScopeValue & { children: ReactNode }) {
  const value = useMemo(() => ({ messageId, traceSessionId }), [messageId, traceSessionId])

  return <MessageRenderTimingContext.Provider value={value}>{children}</MessageRenderTimingContext.Provider>
}

export const useMessageRenderTimingScope = () => useContext(MessageRenderTimingContext)

export function useMessageRenderTiming(
  traceSessionId: string | null,
  messageId: string,
  kind: RenderTimingKind
): () => void {
  const renderStartedAt = performance.now()
  let renderBodyFinishedAt = renderStartedAt
  const traceRequestId = activeSessionSwitchTraceRequestId(traceSessionId)
  const traceKey = `${traceRequestId ?? 'inactive'}:${messageId}`
  const insertionCommitRef = useRef<{ at: number; traceKey: string } | null>(null)
  const lastLayoutTraceKeyRef = useRef<string | null>(null)

  useInsertionEffect(() => {
    if (traceRequestId !== undefined) {
      insertionCommitRef.current = { at: performance.now(), traceKey }
    }
  })

  useLayoutEffect(() => {
    const insertionCommit = insertionCommitRef.current

    if (lastLayoutTraceKeyRef.current === traceKey || insertionCommit?.traceKey !== traceKey) {
      return
    }

    lastLayoutTraceKeyRef.current = traceKey

    const phases = measureRenderCommitPhases(
      renderStartedAt,
      renderBodyFinishedAt,
      insertionCommit.at,
      performance.now()
    )

    markActiveSessionSwitchTraceForRequest(traceSessionId, traceRequestId, `${kind}-layout-commit`, {
      insertionCommitToLayoutMs: phases.insertionCommitToLayoutMs,
      messageId,
      renderBodyDurationMs: phases.renderBodyDurationMs,
      renderToInsertionCommitMs: phases.renderToInsertionCommitMs,
      renderToLayoutCommitMs: phases.renderToInsertionCommitMs + phases.insertionCommitToLayoutMs
    })
  })

  return () => {
    renderBodyFinishedAt = performance.now()
  }
}
