import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatBarState } from '@/app/chat/composer/types'
import { ModelMenuPanel } from '@/app/shell/model-menu-panel'
import {
  $activeSessionId,
  $currentModel,
  $currentProvider,
  setCurrentModel,
  setCurrentModelSource
} from '@/store/session'

import { ModelPill } from './model-pill'

const modelState = (over: Partial<ChatBarState['model']> = {}): ChatBarState['model'] => ({
  canSwitch: true,
  model: 'gpt-6',
  provider: 'openai',
  ...over
})

afterEach(() => {
  cleanup()
  $activeSessionId.set(null)
  setCurrentModel('')
  $currentProvider.set('')
  setCurrentModelSource('')
})

// #62055: a manual composer pick is sticky and silently overrides the
// Settings → Model default for every NEW chat. The pill must say so.
describe('ModelPill pinned-override badge', () => {
  it('shows the pin dot on a draft running a manual pick', () => {
    setCurrentModel('deepseek/deepseek-v4-flash')
    setCurrentModelSource('manual')
    $activeSessionId.set(null)

    render(<ModelPill disabled={false} model={modelState()} />)

    expect(screen.getByTestId('model-pinned-dot')).toBeTruthy()
  })

  it('stays quiet when the composer reflects the profile default', () => {
    setCurrentModel('google/gemma-4-26b-a4b-it:free')
    setCurrentModelSource('default')
    $activeSessionId.set(null)

    render(<ModelPill disabled={false} model={modelState()} />)

    expect(screen.queryByTestId('model-pinned-dot')).toBeNull()
  })

  it('stays quiet on a live session (footer shows that session, not the pin)', () => {
    setCurrentModel('deepseek/deepseek-v4-flash')
    setCurrentModelSource('manual')
    $activeSessionId.set('live-1')

    render(<ModelPill disabled={false} model={modelState()} />)

    expect(screen.queryByTestId('model-pinned-dot')).toBeNull()
  })

  it('is exercised in both render paths', () => {
    setCurrentModel('deepseek/deepseek-v4-flash')
    setCurrentModelSource('manual')
    $activeSessionId.set(null)

    // Fallback (no live menu) path.
    const { unmount } = render(<ModelPill disabled={false} model={modelState()} />)
    expect(screen.getByTestId('model-pinned-dot')).toBeTruthy()
    unmount()

    // Live-menu (dropdown) path.
    render(<ModelPill disabled={false} model={modelState({ modelMenuContent: <div /> })} />)
    expect(screen.getByTestId('model-pinned-dot')).toBeTruthy()
    expect($currentModel.get()).toBe('deepseek/deepseek-v4-flash')
  })
})

describe('ModelPill model-options query lifecycle', () => {
  it('does not query on mount or an A-to-B session switch until the compact picker opens', async () => {
    const gateway = { request: vi.fn(() => Promise.resolve({ providers: [] })) }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const menu = <ModelMenuPanel gateway={gateway as never} onSelectModel={vi.fn()} requestGateway={vi.fn() as never} />

    $activeSessionId.set('runtime-a')
    setCurrentModel('model-a')
    $currentProvider.set('provider-a')

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ModelPill disabled={false} model={modelState({ modelMenuContent: menu })} />
      </QueryClientProvider>
    )

    expect(gateway.request).not.toHaveBeenCalled()

    act(() => $activeSessionId.set('runtime-b'))

    expect(gateway.request).not.toHaveBeenCalled()

    fireEvent.pointerDown(container.querySelector('button')!, { button: 0, ctrlKey: false })

    await waitFor(() => {
      expect(gateway.request).toHaveBeenCalledTimes(1)
    })
    expect(gateway.request).toHaveBeenCalledWith('model.options', {
      explicit_only: true,
      session_id: 'runtime-b'
    })
  })
})
