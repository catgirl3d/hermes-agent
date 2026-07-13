import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSessionSwitchTrace, markActiveSessionSwitchTrace, measureActiveSessionSwitchTrace } from './session-switch-trace'

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
        stages: expect.arrayContaining([expect.objectContaining({ name: 'initial-cache', warm: true })])
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
        stages: expect.arrayContaining([expect.objectContaining({ messageCount: 14, name: 'react-layout-commit' })])
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
            durationMs: expect.any(Number),
            messageCount: 5,
            name: 'runtime-message-repository-built'
          })
        ])
      })
    )
  })
})
