import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ModelPickerDialog } from './model-picker'

class ResizeObserverMock {
  disconnect() {}
  observe() {}
  unobserve() {}
}

globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver

afterEach(cleanup)

describe('ModelPickerDialog model-options query lifecycle', () => {
  it('does not start the full picker query while closed and starts it once when opened', async () => {
    const gateway = { request: vi.fn(() => Promise.resolve({ providers: [] })) }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const props = {
      currentModel: 'model-a',
      currentProvider: 'provider-a',
      gw: gateway as never,
      onOpenChange: vi.fn(),
      onSelect: vi.fn(),
      sessionId: 'runtime-a'
    }

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ModelPickerDialog {...props} open={false} />
      </QueryClientProvider>
    )

    expect(gateway.request).not.toHaveBeenCalled()

    rerender(
      <QueryClientProvider client={queryClient}>
        <ModelPickerDialog {...props} open />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(gateway.request).toHaveBeenCalledTimes(1)
    })
    expect(gateway.request).toHaveBeenCalledWith('model.options', {
      explicit_only: true,
      session_id: 'runtime-a'
    })
  })
})
