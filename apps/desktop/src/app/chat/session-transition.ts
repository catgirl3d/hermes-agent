interface SessionTransitionStateInput {
  activeSessionId: null | string
  hasVisibleSession: boolean
  isRoutedSessionView: boolean
  resumeExhausted: boolean
  routeSessionMismatch: boolean
}

interface SessionTransitionState {
  loadingSession: boolean
  suppressMessages: boolean
}

interface SessionTransitionRuntimeSyncModeInput {
  layoutSyncedRequestId: number | undefined
  runtimeSyncMode: 'layout' | 'passive'
  suppressMessages: boolean
  traceRequestId: number | undefined
  wasSuppressingMessages: boolean
}

export function getSessionTransitionState({
  activeSessionId,
  hasVisibleSession,
  isRoutedSessionView,
  resumeExhausted,
  routeSessionMismatch
}: SessionTransitionStateInput): SessionTransitionState {
  return {
    loadingSession:
      !resumeExhausted && isRoutedSessionView && (routeSessionMismatch || (!hasVisibleSession && !activeSessionId)),
    suppressMessages: routeSessionMismatch
  }
}

export function getSessionTransitionRuntimeSyncMode({
  layoutSyncedRequestId,
  runtimeSyncMode,
  suppressMessages,
  traceRequestId,
  wasSuppressingMessages
}: SessionTransitionRuntimeSyncModeInput): 'layout' | 'passive' {
  if (suppressMessages || wasSuppressingMessages) {
    return 'layout'
  }

  if (runtimeSyncMode === 'layout' && traceRequestId === undefined) {
    return 'layout'
  }

  return runtimeSyncMode === 'layout' && traceRequestId !== undefined && layoutSyncedRequestId !== traceRequestId
    ? 'layout'
    : 'passive'
}
