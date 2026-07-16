import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { HermesGateway } from '@/hermes'

import { useComposerIntentPrewarm } from './use-composer-intent-prewarm'

function gatewayWithRequest(request: ReturnType<typeof vi.fn>) {
  return { request } as unknown as HermesGateway
}

describe('useComposerIntentPrewarm', () => {
  it('requests only the first intent for each runtime session', () => {
    const request = vi.fn().mockResolvedValue({ accepted: true })
    const gateway = gatewayWithRequest(request)

    const { rerender, result } = renderHook(({ sessionId }) => useComposerIntentPrewarm({ gateway, sessionId }), {
      initialProps: { sessionId: 'runtime-a' as string | null }
    })

    act(() => {
      result.current('text')
      result.current('attachment')
      result.current('voice')
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('session.prewarm', {
      intent: 'text',
      session_id: 'runtime-a'
    })

    rerender({ sessionId: 'runtime-b' })
    act(() => result.current('voice'))

    expect(request).toHaveBeenLastCalledWith('session.prewarm', {
      intent: 'voice',
      session_id: 'runtime-b'
    })
  })

  it('does nothing before a runtime session exists', () => {
    const request = vi.fn().mockResolvedValue({ accepted: true })

    const { result } = renderHook(() =>
      useComposerIntentPrewarm({ gateway: gatewayWithRequest(request), sessionId: null })
    )

    act(() => result.current('text'))

    expect(request).not.toHaveBeenCalled()
  })

  it('allows the next intent to retry after a transient failure', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('gateway disconnected'))
      .mockResolvedValueOnce({ accepted: true })

    const { result } = renderHook(() =>
      useComposerIntentPrewarm({ gateway: gatewayWithRequest(request), sessionId: 'runtime-a' })
    )

    await act(async () => {
      result.current('text')
      await Promise.resolve()
    })
    act(() => result.current('voice'))

    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenLastCalledWith('session.prewarm', {
      intent: 'voice',
      session_id: 'runtime-a'
    })
  })
})
