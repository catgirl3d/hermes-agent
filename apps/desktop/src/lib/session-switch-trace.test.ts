import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  activeSessionSwitchTraceRequestId,
  createSessionSwitchTrace,
  elapsedSinceActiveSessionSwitchStage,
  markActiveSessionSwitchTrace,
  markActiveSessionSwitchTraceForRequest,
  measureActiveSessionSwitchTrace,
  measureRenderCommitPhases,
  recordSessionSwitchTransportTiming
} from './session-switch-trace'

describe('session switch trace', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits one structured console trace when a switch completes', () => {
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const groupEnd = vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined)
    const trace = createSessionSwitchTrace({ requestId: 7, storedSessionId: 'stored-session-1234' })

    trace.mark('initial-cache', { warm: true })
    trace.complete('warm-restored', { messageCount: 12 })

    expect(group).toHaveBeenCalledWith(expect.stringContaining('[session-switch #7]'))
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'warm-restored',
        requestId: 7,
        stages: expect.arrayContaining([
          expect.objectContaining({ name: 'initial-cache', sincePreviousStageMs: expect.any(Number), warm: true })
        ])
      })
    )
    expect(groupEnd).toHaveBeenCalledTimes(1)
  })

  it('records a stage reported by another renderer boundary', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const trace = createSessionSwitchTrace({ requestId: 8, storedSessionId: 'stored-session-5678' })

    markActiveSessionSwitchTrace('stored-session-5678', 'react-layout-commit', { messageCount: 14 })
    trace.complete('cold-resumed')

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        stages: expect.arrayContaining([
          expect.objectContaining({
            messageCount: 14,
            name: 'react-layout-commit',
            sincePreviousStageMs: expect.any(Number)
          })
        ])
      })
    )
  })

  it('measures elapsed time from an active stage and stops exposing it after completion', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const now = vi.spyOn(performance, 'now')

    now.mockReturnValueOnce(10).mockReturnValueOnce(25)
    const trace = createSessionSwitchTrace({ requestId: 12, storedSessionId: 'stored-session-elapsed' })

    trace.mark('runtime-adapter-synced')

    expect(elapsedSinceActiveSessionSwitchStage('stored-session-elapsed', 'runtime-adapter-synced', 40.26)).toBe(15.3)
    expect(elapsedSinceActiveSessionSwitchStage('stored-session-elapsed', 'missing-stage', 40.26)).toBeUndefined()

    now.mockReturnValue(50)
    trace.complete('cold-resumed')

    expect(elapsedSinceActiveSessionSwitchStage('stored-session-elapsed', 'runtime-adapter-synced', 60)).toBeUndefined()
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('gives a repeated resume of the same session a distinct active trace identity', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const first = createSessionSwitchTrace({ requestId: 13, storedSessionId: 'stored-session-retry' })

    expect(activeSessionSwitchTraceRequestId('stored-session-retry')).toBe(13)

    const retry = createSessionSwitchTrace({ requestId: 14, storedSessionId: 'stored-session-retry' })

    expect(activeSessionSwitchTraceRequestId('stored-session-retry')).toBe(14)
    expect(elapsedSinceActiveSessionSwitchStage('stored-session-retry', 'first-only', 100, 13)).toBeUndefined()

    markActiveSessionSwitchTraceForRequest('stored-session-retry', 13, 'stale-layout-commit')
    markActiveSessionSwitchTraceForRequest('stored-session-retry', 14, 'current-layout-commit')

    first.complete('superseded')
    expect(activeSessionSwitchTraceRequestId('stored-session-retry')).toBe(14)

    retry.complete('cold-resumed')
    expect(activeSessionSwitchTraceRequestId('stored-session-retry')).toBeUndefined()

    const retrySummary = info.mock.calls.map(call => call[0]).find(summary => summary?.requestId === 14)

    expect(retrySummary.stages).toEqual([expect.objectContaining({ name: 'current-layout-commit' })])
  })

  it('splits render, insertion commit, and layout into non-negative phases', () => {
    expect(measureRenderCommitPhases(10, 12.04, 20.08, 25.16)).toEqual({
      insertionCommitToLayoutMs: 5.1,
      renderBodyDurationMs: 2,
      renderToInsertionCommitMs: 10.1
    })
    expect(measureRenderCommitPhases(10, 9, 8, 7)).toEqual({
      insertionCommitToLayoutMs: 0,
      renderBodyDurationMs: 0,
      renderToInsertionCommitMs: 0
    })
  })

  it('records exact post-response WebSocket send timing', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const trace = createSessionSwitchTrace({ requestId: 11, storedSessionId: 'stored-session-transport' })

    recordSessionSwitchTransportTiming({
      stored_session_id: 'stored-session-transport',
      json_serialize_ms: 0.7,
      prefix_frame_count: 2,
      prefix_send_ms: 1.2,
      response_send_ms: 3.4,
      send_total_ms: 4.6
    })
    trace.complete('cold-resumed')

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        stages: expect.arrayContaining([
          expect.objectContaining({
            backendJsonSerializeMs: 0.7,
            backendPrefixFrameCount: 2,
            backendPrefixSendMs: 1.2,
            backendResponseSendMs: 3.4,
            backendSendTotalMs: 4.6,
            name: 'resume-response-sent'
          })
        ])
      })
    )
  })

  it('assigns an interval duration to every stage', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const trace = createSessionSwitchTrace({ requestId: 10, storedSessionId: 'stored-session-1010' })

    trace.mark('first')
    trace.mark('second')
    trace.complete('cold-resumed')

    const summary = info.mock.calls[0]?.[0] as { stages: Array<Record<string, unknown>> }

    expect(Object.keys(summary.stages[0] ?? {})).toEqual(['atMs', 'sincePreviousStageMs', 'name'])
    expect(Object.keys(summary.stages[1] ?? {})).toEqual(['atMs', 'sincePreviousStageMs', 'name'])
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        stages: expect.arrayContaining([
          expect.objectContaining({ name: 'first', sincePreviousStageMs: expect.any(Number) }),
          expect.objectContaining({ name: 'second', sincePreviousStageMs: expect.any(Number) })
        ])
      })
    )
  })

  it('measures a synchronous stage and includes derived fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const trace = createSessionSwitchTrace({ requestId: 9, storedSessionId: 'stored-session-9012' })

    const result = measureActiveSessionSwitchTrace(
      'stored-session-9012',
      'runtime-message-repository-built',
      () => ['a', 'b', 'c'],
      items => ({ coalescedCount: items.length, messageCount: items.length + 2 })
    )

    trace.complete('cold-resumed')

    expect(result).toEqual(['a', 'b', 'c'])
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        stages: expect.arrayContaining([
          expect.objectContaining({
            coalescedCount: 3,
            messageCount: 5,
            name: 'runtime-message-repository-built',
            operationDurationMs: expect.any(Number),
            sincePreviousStageMs: expect.any(Number)
          })
        ])
      })
    )
  })
})
