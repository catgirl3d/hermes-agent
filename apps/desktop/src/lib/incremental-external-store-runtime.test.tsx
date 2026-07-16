// @vitest-environment jsdom

import { ExportedMessageRepository, type ExternalStoreAdapter, type ThreadMessage } from '@assistant-ui/react'
import { renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
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

  it.each([
    ['layout', ['sync-start', 'sync', 'consumer-layout']],
    ['passive', ['consumer-layout', 'sync-start', 'sync']]
  ] as const)('synchronizes a %s adapter in the requested effect phase', async (syncMode, expectedOrder) => {
    const adapter: ExternalStoreAdapter<ThreadMessage> = {
      isRunning: false,
      messageRepository: ExportedMessageRepository.fromBranchableArray([], { headId: null }),
      onNew: async () => undefined
    }

    const events: string[] = []

    renderHook(() => {
      useIncrementalExternalStoreRuntime(adapter, {
        onAdapterSync: () => events.push('sync'),
        onAdapterSyncStart: () => events.push('sync-start'),
        syncMode
      })

      useLayoutEffect(() => {
        events.push('consumer-layout')
      }, [])
    })

    await waitFor(() => expect(events).toEqual(expectedOrder))
  })
})
