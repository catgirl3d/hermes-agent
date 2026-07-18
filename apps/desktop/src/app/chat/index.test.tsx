import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'
import {
  $freshDraftReady,
  $gatewayState,
  $resumeExhaustedSessionId,
  $selectedStoredSessionId,
  $sessions
} from '@/store/session'

import { type SessionView, SessionViewProvider } from './session-view'

import { ChatView } from './index'

let latestRuntimeAdapter: { messageRepository: ChatMessage[] } | null = null
let latestRuntimeSyncMode: string | null = null

vi.mock('@assistant-ui/react', () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@/components/assistant-ui/thread', () => ({
  Thread: ({ sessionId, sessionKey }: { sessionId?: string | null; sessionKey?: string | null }) => (
    <output data-session-id={sessionId} data-session-key={sessionKey} data-testid="thread" />
  )
}))

vi.mock('@/lib/incremental-external-store-runtime', () => ({
  useIncrementalExternalStoreRuntime: (
    adapter: { messageRepository: ChatMessage[] },
    options: { syncMode: string }
  ) => {
    latestRuntimeAdapter = adapter
    latestRuntimeSyncMode = options.syncMode

    return {}
  }
}))

vi.mock('./composer', () => ({
  ChatBar: ({ disabled, sessionId }: { disabled: boolean; sessionId?: string | null }) => (
    <input data-session-id={sessionId} data-testid="composer" disabled={disabled} />
  )
}))

vi.mock('./composer/scope', () => ({ useComposerScope: () => ({ target: 'test-composer' }) }))
vi.mock('./hooks/use-composer-intent-prewarm', () => ({ useComposerIntentPrewarm: () => vi.fn() }))
vi.mock('./hooks/use-file-drop-zone', () => ({ useFileDropZone: () => ({ dragKind: null, dropHandlers: {} }) }))
vi.mock('./runtime-repository', () => ({ useRuntimeMessageRepository: (messages: ChatMessage[]) => messages }))
vi.mock('./sidebar/session-actions-menu', () => ({
  SessionActionsMenu: ({ children }: { children: React.ReactNode }) => children
}))
vi.mock('./chat-drop-overlay', () => ({ ChatDropOverlay: () => null }))
vi.mock('./chat-swap-overlay', () => ({ ChatSwapOverlay: () => null }))
vi.mock('./scroll-to-bottom-button', () => ({ ScrollToBottomButton: () => null }))
vi.mock('@/components/Backdrop', () => ({ Backdrop: () => null }))
vi.mock('@/components/prompt-overlays', () => ({ PromptOverlays: () => null }))
vi.mock('@/components/chat/vibe-hearts', () => ({ COMPOSER_HEART_CONFIG: {}, HeartField: () => null }))
vi.mock('@/components/ui/title-menu-trigger', () => ({
  TitleMenuTrigger: ({ children }: { children: React.ReactNode }) => children
}))
vi.mock('@/store/windows', () => ({ isSecondaryWindow: () => false, isWatchWindow: () => false }))

function NavigateToB() {
  const navigate = useNavigate()

  return <button onClick={() => navigate('/stored-b')}>Open B</button>
}

const callbacks = {
  onAddContextRef: vi.fn(),
  onAddUrl: vi.fn(),
  onAttachDroppedItems: vi.fn(),
  onAttachImageBlob: vi.fn(),
  onBranchInNewChat: vi.fn(),
  onCancel: vi.fn(),
  onDeleteSelectedSession: vi.fn(),
  onEdit: vi.fn(),
  onPasteClipboardImage: vi.fn(),
  onPickFiles: vi.fn(),
  onPickFolders: vi.fn(),
  onPickImages: vi.fn(),
  onReload: vi.fn(),
  onRemoveAttachment: vi.fn(),
  onRetryResume: vi.fn(),
  onSteer: vi.fn(),
  onSubmit: vi.fn(() => true),
  onThreadMessagesChange: vi.fn(),
  onToggleSelectedPin: vi.fn()
}

describe('ChatView session transition', () => {
  const runtimeId = atom<string | null>('runtime-a')
  const storedId = atom<string | null>('stored-a')

  const messages = atom<ChatMessage[]>([
    { content: [{ type: 'text', text: 'A message' }], id: 'a', role: 'user' }
  ] as never)

  const busy = atom(false)
  const awaitingResponse = atom(false)
  const messagesEmpty = atom(false)
  const lastVisibleIsUser = atom(true)
  const cwd = atom('/workspace/a')
  const model = atom('model-a')
  const provider = atom('provider-a')

  const view: SessionView = {
    $awaitingResponse: awaitingResponse,
    $busy: busy,
    $cwd: cwd,
    $lastVisibleIsUser: lastVisibleIsUser,
    $messages: messages,
    $messagesEmpty: messagesEmpty,
    $model: model,
    $provider: provider,
    $runtimeId: runtimeId,
    $storedId: storedId,
    kind: 'primary'
  }

  beforeEach(() => {
    runtimeId.set('runtime-a')
    storedId.set('stored-a')
    messages.set([{ content: [{ type: 'text', text: 'A message' }], id: 'a', role: 'user' }] as never)
    cwd.set('/workspace/a')
    model.set('model-a')
    provider.set('provider-a')
    $freshDraftReady.set(false)
    $gatewayState.set('open')
    $resumeExhaustedSessionId.set(null)
    $selectedStoredSessionId.set('stored-a')
    $sessions.set([])
    latestRuntimeAdapter = null
    latestRuntimeSyncMode = null
  })

  afterEach(() => {
    cleanup()
    $gatewayState.set('idle')
    $selectedStoredSessionId.set(null)
  })

  it('suppresses A while preserving the composer, then publishes B transcript and binding together', async () => {
    render(
      <MemoryRouter initialEntries={['/stored-a']}>
        <SessionViewProvider value={view}>
          <NavigateToB />
          <ChatView {...callbacks} gateway={null} />
        </SessionViewProvider>
      </MemoryRouter>
    )

    const composer = await screen.findByTestId('composer')
    const composerWrapper = composer.parentElement!

    expect(screen.getByTestId('thread').getAttribute('data-session-key')).toBe('stored-a')
    expect(composer.getAttribute('data-session-id')).toBe('runtime-a')

    act(() => $selectedStoredSessionId.set('stored-b'))
    fireEvent.click(screen.getByRole('button', { name: 'Open B' }))

    expect(latestRuntimeAdapter?.messageRepository).toEqual([])
    expect(composer.parentElement).toBe(composerWrapper)
    expect(composerWrapper.getAttribute('aria-hidden')).toBe('true')
    expect(composerWrapper.hasAttribute('hidden')).toBe(true)
    expect(composerWrapper.hasAttribute('inert')).toBe(true)
    expect((composer as HTMLInputElement).disabled).toBe(true)

    act(() => {
      runtimeId.set('runtime-b')
      storedId.set('stored-b')
      cwd.set('/workspace/b')
      model.set('model-b')
      provider.set('provider-b')
      messages.set([{ content: [{ type: 'text', text: 'B message' }], id: 'b', role: 'assistant' }] as never)
    })

    await waitFor(() => {
      expect(screen.getByTestId('thread').getAttribute('data-session-key')).toBe('stored-b')
      expect(composer.getAttribute('data-session-id')).toBe('runtime-b')
      expect(composerWrapper.hasAttribute('hidden')).toBe(false)
    })

    expect(latestRuntimeAdapter?.messageRepository).toEqual(messages.get())
    expect(latestRuntimeSyncMode).toBe('layout')
    expect(composer.parentElement).toBe(composerWrapper)
    expect(composerWrapper.getAttribute('aria-hidden')).toBe('false')
    expect(composerWrapper.hasAttribute('inert')).toBe(false)
    expect((composer as HTMLInputElement).disabled).toBe(false)
  })
})
