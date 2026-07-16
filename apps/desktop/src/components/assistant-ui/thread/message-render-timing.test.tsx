import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSessionSwitchTrace } from '@/lib/session-switch-trace'

import { useMessageRenderTiming } from './message-render-timing'

describe('useMessageRenderTiming', () => {
  afterEach(() => vi.restoreAllMocks())

  it('records one committed message subtree per trace and message', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const trace = createSessionSwitchTrace({ requestId: 21, storedSessionId: 'stored-message-timing' })

    const { rerender } = renderHook(() => {
      const finishRenderBody = useMessageRenderTiming('stored-message-timing', 'message-1', 'assistant-message')

      finishRenderBody()
    })

    rerender()
    trace.complete('cold-resumed')

    const summary = info.mock.calls.map(call => call[0]).find(value => value?.requestId === 21)

    expect(summary.stages).toEqual([
      expect.objectContaining({
        messageId: 'message-1',
        name: 'assistant-message-layout-commit',
        renderBodyDurationMs: expect.any(Number),
        renderToInsertionCommitMs: expect.any(Number),
        renderToLayoutCommitMs: expect.any(Number)
      })
    ])
  })
})
