// @vitest-environment jsdom

import { ExportedMessageRepository, type ExternalStoreAdapter, type ThreadMessage } from '@assistant-ui/react'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useIncrementalExternalStoreRuntime } from './incremental-external-store-runtime'

describe('useIncrementalExternalStoreRuntime', () => {
  it('does not resync a stable adapter after an unrelated rerender', async () => {
    const adapter: ExternalStoreAdapter<ThreadMessage> = {
      isRunning: false,
      messageRepository: ExportedMessageRepository.fromBranchableArray([], { headId: null }),
      onNew: async () => undefined
    }
    const onAdapterSync = vi.fn()
    const { rerender } = renderHook(() =>
      useIncrementalExternalStoreRuntime(adapter, {
        onAdapterSync
      })
    )

    await waitFor(() => expect(onAdapterSync).toHaveBeenCalledTimes(1))
    rerender()

    expect(onAdapterSync).toHaveBeenCalledTimes(1)
  })
})
