import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThreadMessageList } from './list'

const scrollRef: { current: HTMLDivElement | null } = { current: null }
let messageCount = 12
let rafCallbacks: FrameRequestCallback[] = []

vi.mock('@assistant-ui/react', () => ({
  ThreadPrimitive: {
    MessageByIndex: ({ index }: { index: number }) => <div data-testid="message">{index}</div>
  },
  useAuiEvent: () => undefined,
  useAuiState: <T,>(
    selector: (state: { thread: { messages: { content: string; id: string; role: string }[] } }) => T
  ) =>
    selector({
      thread: {
        messages: Array.from({ length: messageCount }, (_, index) => ({
          content: 'part',
          id: `message-${index}`,
          role: index % 2 === 0 ? 'user' : 'assistant'
        }))
      }
    })
}))

vi.mock('use-stick-to-bottom', () => ({
  useStickToBottom: () => ({
    contentRef: { current: null },
    isAtBottom: false,
    scrollRef,
    scrollToBottom: vi.fn(),
    stopScroll: vi.fn()
  })
}))

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: { assistant: { thread: { showEarlier: 'Show earlier' } } } }) }))
vi.mock('@/components/assistant-ui/message-render-boundary', () => ({
  MessageRenderBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))
vi.mock('@/store/windows', () => ({ isSecondaryWindow: () => false }))

beforeEach(() => {
  messageCount = 12
  rafCallbacks = []
  scrollRef.current = null
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(callback => {
      rafCallbacks.push(callback)

      return rafCallbacks.length
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ThreadMessageList earlier-history expansion', () => {
  it('preserves viewport position, ignores a duplicate pending expansion, and supports a later expansion', () => {
    render(<ThreadMessageList clampToComposer={false} components={{} as never} sessionKey="session-a" />)

    const viewport = scrollRef.current!
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => screen.getAllByTestId('message').length * 100
    })
    viewport.scrollTop = 100

    const showEarlier = screen.getByRole('button', { name: 'Show earlier' })

    act(() => {
      showEarlier.click()
      showEarlier.click()
    })

    // Initial two turns plus one pending page of two more turns. The second
    // click shares the pending window and cannot schedule another expansion.
    expect(screen.getAllByTestId('message')).toHaveLength(8)
    expect(viewport.scrollTop).toBe(500)

    fireEvent.click(showEarlier)

    expect(screen.getAllByTestId('message')).toHaveLength(12)
    expect(viewport.scrollTop).toBe(900)
  })

  it('only reveals history from an upward wheel intent at the visible boundary', () => {
    render(<ThreadMessageList clampToComposer={false} components={{} as never} sessionKey="session-a" />)

    const viewport = scrollRef.current!
    const showEarlier = screen.getByRole('button', { name: 'Show earlier' })
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 500, top: 0 })
    })
    Object.defineProperty(showEarlier, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 40, top: 20 })
    })

    fireEvent.wheel(viewport, { deltaY: 10 })
    expect(screen.getAllByTestId('message')).toHaveLength(4)

    fireEvent.wheel(viewport, { deltaY: -10 })
    expect(screen.getAllByTestId('message')).toHaveLength(8)
  })

  it('keeps a long transcript at its initial window after scroll settling', () => {
    messageCount = 200
    render(<ThreadMessageList clampToComposer={false} components={{} as never} sessionKey="long-session" />)

    const viewport = scrollRef.current!
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 5_000 })

    // rAF is reserved for scroll settling. The first callback observes the DOM
    // height written after mount, then two stable frames finish the handoff.
    // None of those callbacks may mount older turns.
    act(() => {
      rafCallbacks.shift()?.(0)
      rafCallbacks.shift()?.(16)
      rafCallbacks.shift()?.(32)
    })

    expect(screen.getAllByTestId('message')).toHaveLength(4)
    expect(rafCallbacks).toHaveLength(0)
  })
})
