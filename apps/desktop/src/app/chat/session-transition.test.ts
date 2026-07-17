import { describe, expect, it } from 'vitest'

import { getSessionTransitionRuntimeSyncMode, getSessionTransitionState } from './session-transition'

describe('getSessionTransitionState', () => {
  it('suppresses the previous transcript while a new route is pending', () => {
    expect(
      getSessionTransitionState({
        activeSessionId: 'runtime-old',
        hasVisibleSession: true,
        isRoutedSessionView: true,
        resumeExhausted: false,
        routeSessionMismatch: true
      })
    ).toEqual({ loadingSession: true, suppressMessages: true })
  })

  it('shows the transcript once the visible snapshot matches the route', () => {
    expect(
      getSessionTransitionState({
        activeSessionId: 'runtime-target',
        hasVisibleSession: true,
        isRoutedSessionView: true,
        resumeExhausted: false,
        routeSessionMismatch: false
      })
    ).toEqual({ loadingSession: false, suppressMessages: false })
  })

  it('synchronizes both suppression and restoration before paint', () => {
    expect(
      getSessionTransitionRuntimeSyncMode({
        layoutSyncedRequestId: undefined,
        runtimeSyncMode: 'passive',
        suppressMessages: true,
        traceRequestId: undefined,
        wasSuppressingMessages: false
      })
    ).toBe('layout')

    expect(
      getSessionTransitionRuntimeSyncMode({
        layoutSyncedRequestId: undefined,
        runtimeSyncMode: 'passive',
        suppressMessages: false,
        traceRequestId: undefined,
        wasSuppressingMessages: true
      })
    ).toBe('layout')
  })

  it('honors an explicit layout sync without a session-switch trace', () => {
    expect(
      getSessionTransitionRuntimeSyncMode({
        layoutSyncedRequestId: undefined,
        runtimeSyncMode: 'layout',
        suppressMessages: false,
        traceRequestId: undefined,
        wasSuppressingMessages: false
      })
    ).toBe('layout')
  })
})
