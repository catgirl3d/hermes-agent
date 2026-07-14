import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSessionMessages, type SessionInfo } from '@/hermes'
import { createClientSessionState } from '@/lib/chat-runtime'
import { prepareSessionSnapshot } from '@/lib/session-view-snapshot'
import { $activeGatewayProfile, $newChatProfile } from '@/store/profile'
import { $projectScope, $projectTree, ALL_PROJECTS } from '@/store/projects'
import {
  $activeSessionId,
  $currentCwd,
  $messages,
  $newChatWorkspaceTarget,
  $resumeFailedSessionId,
  $sessionViewSnapshot,
  publishSessionViewSnapshot,
  setActiveSessionId,
  setCurrentCwd,
  setMessages,
  setNewChatWorkspaceTarget,
  setResumeFailedSessionId,
  setSessions
} from '@/store/session'

import type { ClientSessionState } from '../../types'

import { useSessionActions } from './use-session-actions'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteSession: vi.fn(),
  getSessionMessages: vi.fn(),
  listAllProfileSessions: vi.fn(),
  setApiRequestProfile: vi.fn(),
  setSessionArchived: vi.fn()
}))

const RUNTIME_SESSION_ID = 'rt-new-001'
type HarnessHandle = Pick<
  ReturnType<typeof useSessionActions>,
  'createBackendSessionForSend' | 'startFreshSessionDraft'
>

function storedSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    ended_at: null,
    id: 'stored-1',
    input_tokens: 0,
    is_active: false,
    last_active: 1,
    message_count: 0,
    model: null,
    output_tokens: 0,
    preview: null,
    source: 'desktop',
    started_at: 1,
    title: 'stored',
    tool_call_count: 0,
    ...overrides
  }
}

function Harness({
  onReady,
  requestGateway
}: {
  onReady: (handle: HarnessHandle) => void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}) {
  const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value })

  const actions = useSessionActions({
    activeSessionId: null,
    activeSessionIdRef: ref<string | null>(null),
    busyRef: ref(false),
    creatingSessionRef: ref(false),
    ensureSessionState: () => ({}) as ClientSessionState,
    getRouteToken: () => 'token',
    navigate: vi.fn() as never,
    requestGateway,
    runtimeIdByStoredSessionIdRef: ref(new Map<string, string>()),
    selectedStoredSessionId: null,
    selectedStoredSessionIdRef: ref<string | null>(null),
    sessionStateByRuntimeIdRef: ref(new Map<string, ClientSessionState>()),
    updateSessionState: () => ({}) as ClientSessionState
  })

  useEffect(() => {
    onReady(actions)
  }, [actions, onReady])

  return null
}

async function createWith(
  profileSetup: () => void,
  beforeCreate?: (handle: HarnessHandle) => Promise<void> | void
): Promise<Record<string, unknown> | undefined> {
  let createParams: Record<string, unknown> | undefined

  const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'session.create') {
      createParams = params

      return { session_id: RUNTIME_SESSION_ID, stored_session_id: null } as never
    }

    return {} as never
  })

  setCurrentCwd('')
  setNewChatWorkspaceTarget(undefined)
  profileSetup()

  let handle: HarnessHandle | null = null
  render(<Harness onReady={h => (handle = h)} requestGateway={requestGateway} />)
  await waitFor(() => expect(handle).not.toBeNull())

  if (beforeCreate) {
    await act(async () => {
      await beforeCreate(handle!)
    })
  }

  await act(async () => {
    await handle!.createBackendSessionForSend()
  })

  return createParams
}

describe('createBackendSessionForSend profile routing', () => {
  afterEach(() => {
    cleanup()
    $newChatProfile.set(null)
    $activeGatewayProfile.set('default')
    $projectScope.set(ALL_PROJECTS)
    $projectTree.set([])
    $currentCwd.set('')
    setNewChatWorkspaceTarget(undefined)
    vi.restoreAllMocks()
  })

  it('routes a plain new chat (no explicit profile) to the live gateway profile', async () => {
    // The "rubberband to default" bug: the top New Session button clears
    // $newChatProfile to null. In global-remote mode one backend serves every
    // profile, so an omitted `profile` lands the chat on the launch (default)
    // profile. The session must instead carry the active gateway profile.
    const params = await createWith(() => {
      $activeGatewayProfile.set('coder')
      $newChatProfile.set(null)
    })

    expect(params).toMatchObject({ profile: 'coder' })
  })

  it('honours an explicit per-profile "+" selection', async () => {
    const params = await createWith(() => {
      $activeGatewayProfile.set('coder')
      $newChatProfile.set('analyst')
    })

    expect(params).toMatchObject({ profile: 'analyst' })
  })

  it('passes the default profile for single-profile users (backend resolves it to launch)', async () => {
    const params = await createWith(() => {
      $activeGatewayProfile.set('default')
      $newChatProfile.set(null)
    })

    expect(params).toMatchObject({ profile: 'default' })
  })

  it('tags new desktop chats as desktop sessions', async () => {
    const params = await createWith(() => {})

    expect(params).toMatchObject({ source: 'desktop' })
  })

  it('passes the current workspace cwd into session.create', async () => {
    const params = await createWith(() => {
      $currentCwd.set('/remote/worktree')
    })

    expect(params).toMatchObject({ cwd: '/remote/worktree' })
  })

  it('falls back to the entered project cwd when the current cwd is blank', async () => {
    const params = await createWith(() => {
      $projectTree.set([
        {
          id: 'p_app',
          label: 'App',
          path: '/repo/app',
          repos: [{ groups: [], id: '/repo/app', label: 'app', path: '/repo/app', sessionCount: 0 }],
          sessionCount: 0
        }
      ])
      $projectScope.set('p_app')
      $currentCwd.set('')
    })

    expect(params).toMatchObject({ cwd: '/repo/app' })
  })
})

// ── Resume failure recovery (the "stuck loading session window" bug) ──────────
// When session.resume rejects AND the REST transcript fallback ALSO fails, the
// hook must (a) not throw out of the fallback (which stranded the loader), and
// (b) arm $resumeFailedSessionId so use-route-resume can retry. A resume that
// succeeds must NOT leave the flag armed.
function ResumeHarness({
  onReady,
  requestGateway,
  runtimeIdByStoredSessionIdRef,
  sessionStateByRuntimeIdRef,
  updateSessionState
}: {
  onReady: (resume: (storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) => void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  runtimeIdByStoredSessionIdRef?: MutableRefObject<Map<string, string>>
  sessionStateByRuntimeIdRef?: MutableRefObject<Map<string, ClientSessionState>>
  updateSessionState?: (
    sessionId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    storedSessionId?: string | null
  ) => ClientSessionState
}) {
  const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value })

  const actions = useSessionActions({
    activeSessionId: null,
    activeSessionIdRef: ref<string | null>(null),
    busyRef: ref(false),
    creatingSessionRef: ref(false),
    ensureSessionState: () => ({}) as ClientSessionState,
    getRouteToken: () => 'token',
    navigate: vi.fn() as never,
    requestGateway,
    runtimeIdByStoredSessionIdRef: runtimeIdByStoredSessionIdRef ?? ref(new Map<string, string>()),
    selectedStoredSessionId: null,
    selectedStoredSessionIdRef: ref<string | null>(null),
    sessionStateByRuntimeIdRef: sessionStateByRuntimeIdRef ?? ref(new Map<string, ClientSessionState>()),
    updateSessionState:
      updateSessionState ??
      ((_sessionId, updater, storedSessionId) => updater(createClientSessionState(storedSessionId ?? null)))
  })

  useEffect(() => {
    onReady(actions.resumeSession)
  }, [actions.resumeSession, onReady])

  return null
}

describe('resumeSession failure recovery', () => {
  afterEach(() => {
    cleanup()
    setActiveSessionId(null)
    setResumeFailedSessionId(null)
    setMessages([])
    setSessions([])
    vi.restoreAllMocks()
  })

  async function runResume(
    requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>,
    options: {
      runtimeIdByStoredSessionIdRef?: MutableRefObject<Map<string, string>>
      sessionStateByRuntimeIdRef?: MutableRefObject<Map<string, ClientSessionState>>
      updateSessionState?: (
        sessionId: string,
        updater: (state: ClientSessionState) => ClientSessionState,
        storedSessionId?: string | null
      ) => ClientSessionState
    } = {}
  ): Promise<void> {
    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(<ResumeHarness onReady={r => (resume = r)} requestGateway={requestGateway} {...options} />)
    await waitFor(() => expect(resume).not.toBeNull())
    await resume!('stored-1', true)
  }

  it('keeps the previous snapshot visible until the cold target is ready', async () => {
    publishSessionViewSnapshot(
      prepareSessionSnapshot(
        'runtime-old',
        createClientSessionState('stored-old', [
          { id: 'old-message', role: 'user', parts: [{ type: 'text', text: 'old transcript' }] }
        ])
      )
    )
    setSessions([storedSession({ message_count: 0 })])

    let resolveResume: ((value: unknown) => void) | undefined
    const requestGateway = vi.fn((method: string) => {
      if (method === 'session.resume') {
        return new Promise(resolve => {
          resolveResume = resolve
        }) as never
      }

      return Promise.resolve({}) as never
    })
    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(<ResumeHarness onReady={next => (resume = next)} requestGateway={requestGateway} />)
    await waitFor(() => expect(resume).not.toBeNull())

    let pendingResume: Promise<unknown>
    act(() => {
      pendingResume = resume!('stored-1', true)
    })
    await waitFor(() => expect(resolveResume).toBeDefined())

    expect($sessionViewSnapshot.get()).toMatchObject({
      runtimeSessionId: 'runtime-old',
      storedSessionId: 'stored-old'
    })
    expect($sessionViewSnapshot.get().messages[0]?.id).toBe('old-message')

    resolveResume?.({
      session_id: 'runtime-target',
      messages: [{ role: 'user', text: 'target transcript' }],
      info: {}
    })
    await act(async () => pendingResume!)

    expect($sessionViewSnapshot.get()).toMatchObject({
      runtimeSessionId: 'runtime-target',
      storedSessionId: 'stored-1'
    })
  })

  it('does not publish a superseded resume response', async () => {
    publishSessionViewSnapshot(prepareSessionSnapshot('runtime-old', createClientSessionState('stored-old')))
    setSessions([storedSession({ id: 'stored-A' }), storedSession({ id: 'stored-B' })])

    const resolvers = new Map<string, (value: unknown) => void>()
    const requestGateway = vi.fn((method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return new Promise(resolve => {
          resolvers.set(String(params?.session_id), resolve)
        }) as never
      }

      return Promise.resolve({}) as never
    })
    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(<ResumeHarness onReady={next => (resume = next)} requestGateway={requestGateway} />)
    await waitFor(() => expect(resume).not.toBeNull())

    let resumeA: Promise<unknown>
    let resumeB: Promise<unknown>
    act(() => {
      resumeA = resume!('stored-A', true)
    })
    await waitFor(() => expect(resolvers.has('stored-A')).toBe(true))
    act(() => {
      resumeB = resume!('stored-B', true)
    })
    await waitFor(() => expect(resolvers.has('stored-B')).toBe(true))

    resolvers.get('stored-A')?.({ session_id: 'runtime-A', messages: [], info: {} })
    await act(async () => resumeA!)
    expect($sessionViewSnapshot.get().runtimeSessionId).toBe('runtime-old')

    resolvers.get('stored-B')?.({ session_id: 'runtime-B', messages: [], info: {} })
    await act(async () => resumeB!)
    expect($sessionViewSnapshot.get()).toMatchObject({
      runtimeSessionId: 'runtime-B',
      storedSessionId: 'stored-B'
    })
  })

  it('arms $resumeFailedSessionId when resume RPC and REST fallback both fail', async () => {
    // session.resume rejects (e.g. timeout against a wedged backend)...
    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        throw new Error('request timed out: session.resume')
      }

      return {} as never
    })

    // ...and the REST transcript fallback also rejects (backend unreachable).
    vi.mocked(getSessionMessages).mockRejectedValue(new Error('network down'))

    await runResume(requestGateway)

    // The window is no longer silently stranded: the failure latch is armed for
    // the stored session, which use-route-resume consumes to retry.
    expect($resumeFailedSessionId.get()).toBe('stored-1')
  })

  it('does NOT arm the failure latch when the resume RPC fails but the REST fallback paints history', async () => {
    // session.resume rejects, but the REST transcript fallback succeeds and
    // hydrates a readable transcript — the window is NOT stranded.
    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        throw new Error('request timed out: session.resume')
      }

      return {} as never
    })

    vi.mocked(getSessionMessages).mockResolvedValue({
      messages: [
        { content: 'hello', role: 'user', timestamp: 1 },
        { content: 'hi there', role: 'assistant', timestamp: 2 }
      ],
      session_id: 'stored-1'
    } as never)

    await runResume(requestGateway)

    // Arming here would auto-retry a window that already shows history and,
    // on exhaustion, blank that transcript behind the error overlay — a
    // regression vs. plain fallback-success. The latch must stay clear.
    expect($resumeFailedSessionId.get()).toBeNull()
    // The fallback transcript is visible.
    expect($messages.get().length).toBeGreaterThan(0)
  })

  it('does NOT throw out of the fallback when REST also fails (no unhandled rejection)', async () => {
    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        throw new Error('request timed out: session.resume')
      }

      return {} as never
    })

    vi.mocked(getSessionMessages).mockRejectedValue(new Error('network down'))

    // resumeSession must resolve (swallow the fallback failure), not reject.
    await expect(runResume(requestGateway)).resolves.toBeUndefined()
  })

  it('leaves the failure latch clear when resume succeeds', async () => {
    // Pre-arm to prove a successful resume clears it (entry-clear path).
    setResumeFailedSessionId('stored-1')

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return { session_id: 'runtime-1', resumed: params?.session_id, messages: [], info: {} } as never
      }

      return {} as never
    })

    vi.mocked(getSessionMessages).mockResolvedValue({ messages: [] } as never)

    await runResume(requestGateway)

    expect($resumeFailedSessionId.get()).toBeNull()
  })

  it('resumes via the gateway default (deferred build) — not lazy, no eager opt-out', async () => {
    // The switch-latency fix lives backend-side: a normal cold resume gets the
    // gateway's default DEFERRED build (transcript returns immediately). The
    // client must NOT force the synchronous path (eager_build) and is only
    // `lazy` for subagent watch windows.
    let resumeParams: Record<string, unknown> | undefined

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        resumeParams = params

        return { session_id: 'runtime-1', resumed: params?.session_id, messages: [], info: {} } as never
      }

      return {} as never
    })

    vi.mocked(getSessionMessages).mockClear()

    await runResume(requestGateway)

    expect(resumeParams).not.toHaveProperty('lazy')
    expect(resumeParams).not.toHaveProperty('eager_build')
    expect(resumeParams).toMatchObject({ source: 'desktop' })
    expect(getSessionMessages).not.toHaveBeenCalled()
  })

  it('records the post-paint wait that completes a cold-resume trace', async () => {
    const frameCallbacks: FrameRequestCallback[] = []

    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frameCallbacks.push(callback)

      return frameCallbacks.length
    })

    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return {
          session_id: 'runtime-1',
          resumed: params?.session_id,
          messages: [{ role: 'user', text: 'restored prompt' }],
          info: {}
        } as never
      }

      return {} as never
    })

    await runResume(requestGateway)
    expect(requestAnimationFrame).toHaveBeenCalled()

    const flushAnimationFrame = async () => {
      const callbacks = frameCallbacks.splice(0)
      expect(callbacks).not.toHaveLength(0)

      await act(async () => callbacks.forEach(callback => callback(performance.now())))
    }

    await flushAnimationFrame()
    await flushAnimationFrame()

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'cold-resumed',
        stages: expect.arrayContaining([
          expect.objectContaining({ name: 'cold-view-published' }),
          expect.objectContaining({ name: 'paint-wait-start', rafCount: 2, waitMethod: 'double-raf' }),
          expect.objectContaining({
            name: 'paint-raf-1',
            rafCount: 1,
            sincePreviousStageMs: expect.any(Number),
            waitDurationMs: expect.any(Number),
            waitMethod: 'double-raf'
          }),
          expect.objectContaining({
            name: 'paint-raf-2',
            rafCount: 2,
            sincePreviousStageMs: expect.any(Number),
            waitDurationMs: expect.any(Number),
            waitMethod: 'double-raf'
          })
        ])
      })
    )
  })

  it('arms the failure latch when resume succeeds with an empty transcript for a non-empty stored session', async () => {
    setSessions([storedSession({ message_count: 4 })])

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return { session_id: 'runtime-1', resumed: params?.session_id, messages: [], info: {} } as never
      }

      return {} as never
    })

    vi.mocked(getSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-1' } as never)

    await runResume(requestGateway)

    expect($resumeFailedSessionId.get()).toBe('stored-1')
    expect($activeSessionId.get()).toBeNull()
    expect($messages.get()).toEqual([])
  })

  it('does not reuse an empty cached runtime view for a stored session with history', async () => {
    const runtimeIdByStoredSessionIdRef = {
      current: new Map([['stored-1', 'runtime-stale']])
    } satisfies MutableRefObject<Map<string, string>>

    const sessionStateByRuntimeIdRef = {
      current: new Map([
        [
          'runtime-stale',
          {
            awaitingResponse: false,
            branch: '',
            busy: false,
            cwd: '',
            fast: false,
            interrupted: false,
            messages: [],
            model: '',
            needsInput: false,
            pendingBranchGroup: null,
            personality: '',
            provider: '',
            reasoningEffort: '',
            sawAssistantPayload: false,
            serviceTier: '',
            storedSessionId: 'stored-1',
            streamId: null,
            turnStartedAt: null,
            yolo: false
          }
        ]
      ])
    } satisfies MutableRefObject<Map<string, ClientSessionState>>

    setSessions([storedSession({ message_count: 4 })])

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return {
          session_id: 'runtime-1',
          resumed: params?.session_id,
          messages: [{ role: 'user', text: 'existing text' }],
          info: {}
        } as never
      }

      return {} as never
    })

    vi.mocked(getSessionMessages).mockClear()

    const updateSessionState = vi.fn((_sessionId, updater) => {
      const next = updater(clientState('stored-1'))
      setMessages(next.messages)

      return next
    })

    await runResume(requestGateway, {
      runtimeIdByStoredSessionIdRef,
      sessionStateByRuntimeIdRef,
      updateSessionState
    })

    expect(requestGateway).not.toHaveBeenCalledWith('session.usage', { session_id: 'runtime-stale' })
    expect(runtimeIdByStoredSessionIdRef.current.has('stored-1')).toBe(false)
    expect(sessionStateByRuntimeIdRef.current.has('runtime-stale')).toBe(false)
    expect($activeSessionId.get()).toBe('runtime-1')
    expect($messages.get().length).toBe(1)
    expect(getSessionMessages).not.toHaveBeenCalled()
  })
})

function BranchHarness({
  onReady,
  requestGateway
}: {
  onReady: (branchStoredSession: (storedSessionId: string, sessionProfile?: string | null) => Promise<boolean>) => void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}) {
  const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value })

  const actions = useSessionActions({
    activeSessionId: null,
    activeSessionIdRef: ref<string | null>(null),
    busyRef: ref(false),
    creatingSessionRef: ref(false),
    ensureSessionState: () => ({}) as ClientSessionState,
    getRouteToken: () => 'token',
    navigate: vi.fn() as never,
    requestGateway,
    runtimeIdByStoredSessionIdRef: ref(new Map<string, string>()),
    selectedStoredSessionId: null,
    selectedStoredSessionIdRef: ref<string | null>(null),
    sessionStateByRuntimeIdRef: ref(new Map<string, ClientSessionState>()),
    updateSessionState: () => ({}) as ClientSessionState
  })

  useEffect(() => {
    onReady(actions.branchStoredSession)
  }, [actions.branchStoredSession, onReady])

  return null
}

describe('branchStoredSession desktop source tagging', () => {
  afterEach(() => {
    cleanup()
    setSessions([])
    vi.restoreAllMocks()
  })

  it('tags desktop branch sessions as desktop sessions', async () => {
    let createParams: Record<string, unknown> | undefined

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.create') {
        createParams = params

        return { session_id: 'branch-runtime', stored_session_id: 'branch-stored' } as never
      }

      return {} as never
    })

    setSessions([storedSession({ id: 'stored-parent', message_count: 1 })])
    vi.mocked(getSessionMessages).mockResolvedValue({
      messages: [{ content: 'branch me', role: 'user', timestamp: 1 }],
      session_id: 'stored-parent'
    } as never)

    let branchStoredSession: ((storedSessionId: string) => Promise<boolean>) | null = null
    render(<BranchHarness onReady={branch => (branchStoredSession = branch)} requestGateway={requestGateway} />)
    await waitFor(() => expect(branchStoredSession).not.toBeNull())

    await expect(branchStoredSession!('stored-parent')).resolves.toBe(true)

    expect(createParams).toMatchObject({
      parent_session_id: 'stored-parent',
      source: 'desktop'
    })
  })
})

// ── Warm-cache mapping integrity (the "open chat A, chat B loads" bug) ─────────
// resumeSession's warm fast-path maps storedSessionId -> runtimeId -> cached
// state. A reaped/respawned pooled backend re-mints runtime ids, so a recycled
// id can resolve to a live-but-DIFFERENT session's cache entry. The fast-path
// must verify the cached state still BELONGS to the resumed session before it
// paints, or it shows a totally different thread under the current route.
const clientState = (storedSessionId: string | null): ClientSessionState => createClientSessionState(storedSessionId)

describe('resumeSession warm-cache mapping integrity', () => {
  afterEach(() => {
    cleanup()
    setActiveSessionId(null)
    setResumeFailedSessionId(null)
    setMessages([])
    setSessions([])
    vi.restoreAllMocks()
  })

  it('rejects a cross-wired runtime mapping and falls through to a full resume', async () => {
    // A recycled runtime id ('rt-recycled') is mapped to 'stored-A', but its
    // cached state actually belongs to a DIFFERENT session ('stored-B') — the
    // exact "open chat A, chat B loads" corruption a reaped/respawned pooled
    // backend can leave behind.
    const runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>> = {
      current: new Map([['stored-A', 'rt-recycled']])
    }

    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = {
      current: new Map([['rt-recycled', clientState('stored-B')]])
    }

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return { session_id: 'rt-A-fresh', resumed: params?.session_id, messages: [], info: {} } as never
      }

      return {} as never
    })

    vi.mocked(getSessionMessages).mockResolvedValue({ messages: [] } as never)

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <ResumeHarness
        onReady={r => (resume = r)}
        requestGateway={requestGateway}
        runtimeIdByStoredSessionIdRef={runtimeIdByStoredSessionIdRef}
        sessionStateByRuntimeIdRef={sessionStateByRuntimeIdRef}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())
    await resume!('stored-A', true)

    // The fast-path did NOT short-circuit on the cross-wired cache — the full
    // resume RPC ran, for the session that was actually requested.
    const resumeCalls = requestGateway.mock.calls.filter(([method]) => method === 'session.resume')
    expect(resumeCalls.length).toBe(1)
    expect(resumeCalls[0][1]).toMatchObject({ session_id: 'stored-A' })

    // The corrupt mapping was purged so it can't mis-resolve again.
    expect(runtimeIdByStoredSessionIdRef.current.has('stored-A')).toBe(false)
    expect(sessionStateByRuntimeIdRef.current.has('rt-recycled')).toBe(false)
  })

  it('honours a warm cache entry whose stored id matches (no needless refetch)', async () => {
    // Correctly-wired mapping: 'rt-A' <-> 'stored-A'. The fast-path should trust
    // it and never reach session.resume (only the lightweight usage probe).
    const runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>> = {
      current: new Map([['stored-A', 'rt-A']])
    }

    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = {
      current: new Map([['rt-A', clientState('stored-A')]])
    }

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.usage') {
        return { input: 0, output: 0, total: 0 } as never
      }

      return {} as never
    })

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <ResumeHarness
        onReady={r => (resume = r)}
        requestGateway={requestGateway}
        runtimeIdByStoredSessionIdRef={runtimeIdByStoredSessionIdRef}
        sessionStateByRuntimeIdRef={sessionStateByRuntimeIdRef}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())
    await resume!('stored-A', true)

    // Fast-path served the session from cache: no full resume RPC, mapping intact.
    const methods = requestGateway.mock.calls.map(([method]) => method)
    expect(methods).not.toContain('session.resume')
    expect(runtimeIdByStoredSessionIdRef.current.get('stored-A')).toBe('rt-A')
  })

  it('does not await a warm-cache usage probe before restoring the cached view', async () => {
    const runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>> = {
      current: new Map([['stored-A', 'rt-A']])
    }

    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = {
      current: new Map([['rt-A', clientState('stored-A')]])
    }

    let resolveUsage: ((usage: unknown) => void) | undefined

    const usage = new Promise(resolve => {
      resolveUsage = resolve
    })

    const requestGateway = vi.fn((method: string) => {
      if (method === 'session.usage') {
        return usage as Promise<never>
      }

      throw new Error(`unexpected gateway request: ${method}`)
    })

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <ResumeHarness
        onReady={r => (resume = r)}
        requestGateway={requestGateway}
        runtimeIdByStoredSessionIdRef={runtimeIdByStoredSessionIdRef}
        sessionStateByRuntimeIdRef={sessionStateByRuntimeIdRef}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())

    await expect(resume!('stored-A', true)).resolves.toBeUndefined()

    expect($activeSessionId.get()).toBe('rt-A')
    expect(requestGateway).toHaveBeenCalledWith('session.usage', { session_id: 'rt-A' }, 2_000, expect.any(AbortSignal))
    resolveUsage?.({ input: 1, output: 2, total: 3 })
  })

  it('keeps a warm cache entry after a timeout usage probe failure', async () => {
    const runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>> = {
      current: new Map([['stored-A', 'rt-A']])
    }

    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = {
      current: new Map([['rt-A', clientState('stored-A')]])
    }

    let rejectUsage: ((reason?: unknown) => void) | undefined

    const usage = new Promise<never>((_resolve, reject) => {
      rejectUsage = reject
    })

    let classificationCount = 0

    const transientError = new Error('gateway timeout')

    Object.defineProperty(transientError, 'message', {
      get: () => {
        classificationCount += 1

        return 'gateway timeout'
      }
    })

    const requestGateway = vi.fn((method: string) => {
      if (method === 'session.usage') {
        return usage
      }

      throw new Error(`unexpected gateway request: ${method}`)
    })

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <ResumeHarness
        onReady={r => (resume = r)}
        requestGateway={requestGateway}
        runtimeIdByStoredSessionIdRef={runtimeIdByStoredSessionIdRef}
        sessionStateByRuntimeIdRef={sessionStateByRuntimeIdRef}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())

    await resume!('stored-A', true)
    rejectUsage?.(transientError)
    await waitFor(() => expect(classificationCount).toBe(1))

    expect(requestGateway.mock.calls.map(([method]) => method)).not.toContain('session.resume')
    expect(runtimeIdByStoredSessionIdRef.current.get('stored-A')).toBe('rt-A')
    expect(sessionStateByRuntimeIdRef.current.has('rt-A')).toBe(true)
  })

  it('cancels a prior usage probe before beginning another resume', async () => {
    const runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>> = {
      current: new Map([['stored-A', 'rt-A']])
    }

    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = {
      current: new Map([['rt-A', clientState('stored-A')]])
    }

    const signals: AbortSignal[] = []

    const requestGateway = vi.fn(
      (method: string, _params?: Record<string, unknown>, _timeoutMs?: number, signal?: AbortSignal) => {
        if (method === 'session.usage') {
          if (!signal) {
            throw new Error('usage probe needs an abort signal')
          }

          signals.push(signal)

          return new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          })
        }

        throw new Error(`unexpected gateway request: ${method}`)
      }
    )

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <ResumeHarness
        onReady={r => (resume = r)}
        requestGateway={requestGateway}
        runtimeIdByStoredSessionIdRef={runtimeIdByStoredSessionIdRef}
        sessionStateByRuntimeIdRef={sessionStateByRuntimeIdRef}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())

    await resume!('stored-A', true)
    await resume!('stored-A', true)

    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
  })

  it('cancels a warm-cache usage probe when the session view unmounts', async () => {
    const runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>> = {
      current: new Map([['stored-A', 'rt-A']])
    }

    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = {
      current: new Map([['rt-A', clientState('stored-A')]])
    }

    let signal: AbortSignal | undefined

    const requestGateway = vi.fn(
      (method: string, _params?: Record<string, unknown>, _timeoutMs?: number, probeSignal?: AbortSignal) => {
        if (method === 'session.usage') {
          signal = probeSignal

          return new Promise<never>((_resolve, reject) => {
            probeSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
              once: true
            })
          })
        }

        throw new Error(`unexpected gateway request: ${method}`)
      }
    )

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    const rendered = render(
      <ResumeHarness
        onReady={r => (resume = r)}
        requestGateway={requestGateway}
        runtimeIdByStoredSessionIdRef={runtimeIdByStoredSessionIdRef}
        sessionStateByRuntimeIdRef={sessionStateByRuntimeIdRef}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())

    await resume!('stored-A', true)
    expect(signal?.aborted).toBe(false)

    rendered.unmount()

    expect(signal?.aborted).toBe(true)
  })

  it('purges a missing warm runtime and re-resumes the stored session exactly once', async () => {
    const runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>> = {
      current: new Map([['stored-A', 'rt-A']])
    }

    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = {
      current: new Map([['rt-A', clientState('stored-A')]])
    }

    let rejectUsage: ((reason?: unknown) => void) | undefined

    const requestGateway = vi.fn((method: string, params?: Record<string, unknown>) => {
      if (method === 'session.usage') {
        return new Promise<never>((_resolve, reject) => {
          rejectUsage = reject
        })
      }

      if (method === 'session.resume') {
        return Promise.resolve({
          session_id: 'rt-A-fresh',
          resumed: params?.session_id,
          messages: [{ role: 'user', text: 'restored prompt' }],
          info: {}
        }) as Promise<never>
      }

      throw new Error(`unexpected gateway request: ${method}`)
    })

    const updateSessionState = vi.fn((sessionId, updater, storedSessionId?: string | null) => {
      const next = updater(sessionStateByRuntimeIdRef.current.get(sessionId) ?? clientState(storedSessionId ?? null))
      sessionStateByRuntimeIdRef.current.set(sessionId, next)

      if (storedSessionId) {
        runtimeIdByStoredSessionIdRef.current.set(storedSessionId, sessionId)
      }

      return next
    })

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <ResumeHarness
        onReady={r => (resume = r)}
        requestGateway={requestGateway}
        runtimeIdByStoredSessionIdRef={runtimeIdByStoredSessionIdRef}
        sessionStateByRuntimeIdRef={sessionStateByRuntimeIdRef}
        updateSessionState={updateSessionState}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())

    await resume!('stored-A', true)
    expect($activeSessionId.get()).toBe('rt-A')

    rejectUsage?.(new Error('session not found'))

    await waitFor(() => {
      expect(requestGateway.mock.calls.filter(([method]) => method === 'session.resume')).toHaveLength(1)
      expect($activeSessionId.get()).toBe('rt-A-fresh')
    })

    expect(sessionStateByRuntimeIdRef.current.has('rt-A')).toBe(false)
    expect(runtimeIdByStoredSessionIdRef.current.get('stored-A')).toBe('rt-A-fresh')
    expect(sessionStateByRuntimeIdRef.current.has('rt-A-fresh')).toBe(true)
    expect(updateSessionState).toHaveBeenCalledWith('rt-A-fresh', expect.any(Function), 'stored-A')
    await Promise.resolve()
    expect(requestGateway.mock.calls.filter(([method]) => method === 'session.resume')).toHaveLength(1)
  })

  it('ignores a late missing-runtime probe from chat A after switching to chat B', async () => {
    const runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>> = {
      current: new Map([
        ['stored-A', 'rt-A'],
        ['stored-B', 'rt-B']
      ])
    }

    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = {
      current: new Map([
        ['rt-A', clientState('stored-A')],
        ['rt-B', clientState('stored-B')]
      ])
    }

    const signals = new Map<string, AbortSignal>()
    const rejectUsage = new Map<string, (reason?: unknown) => void>()

    const requestGateway = vi.fn(
      (method: string, params?: Record<string, unknown>, _timeoutMs?: number, signal?: AbortSignal) => {
        if (method === 'session.usage') {
          const runtimeId = String(params?.session_id)

          if (!signal) {
            throw new Error('usage probe needs an abort signal')
          }

          signals.set(runtimeId, signal)

          return new Promise<never>((_resolve, reject) => {
            rejectUsage.set(runtimeId, reject)
          })
        }

        throw new Error(`unexpected gateway request: ${method}`)
      }
    )

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <ResumeHarness
        onReady={r => (resume = r)}
        requestGateway={requestGateway}
        runtimeIdByStoredSessionIdRef={runtimeIdByStoredSessionIdRef}
        sessionStateByRuntimeIdRef={sessionStateByRuntimeIdRef}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())

    await resume!('stored-A', true)
    await resume!('stored-B', true)
    expect($activeSessionId.get()).toBe('rt-B')
    expect(signals.get('rt-A')?.aborted).toBe(true)

    rejectUsage.get('rt-A')?.(new Error('session not found'))
    await Promise.resolve()
    await Promise.resolve()

    expect($activeSessionId.get()).toBe('rt-B')
    expect(runtimeIdByStoredSessionIdRef.current.get('stored-A')).toBe('rt-A')
    expect(sessionStateByRuntimeIdRef.current.has('rt-A')).toBe(true)
    expect(runtimeIdByStoredSessionIdRef.current.get('stored-B')).toBe('rt-B')
    expect(sessionStateByRuntimeIdRef.current.has('rt-B')).toBe(true)
    expect(requestGateway.mock.calls.map(([method]) => method)).not.toContain('session.resume')
  })
})

describe('createBackendSessionForSend workspace target', () => {
  afterEach(() => {
    cleanup()
    $newChatProfile.set(null)
    $activeGatewayProfile.set('default')
    setCurrentCwd('')
    setNewChatWorkspaceTarget(undefined)
    vi.restoreAllMocks()
  })

  it('omits cwd for an explicit no-workspace draft even when global cwd changes before send', async () => {
    const params = await createWith(
      () => {
        $activeGatewayProfile.set('default')
      },
      handle => {
        handle.startFreshSessionDraft({ workspaceTarget: null })
        $currentCwd.set('/project-open-in-file-browser')
      }
    )

    expect(params).not.toHaveProperty('cwd')
    expect($newChatWorkspaceTarget.get()).toBeUndefined()
  })

  it('uses the clicked workspace target instead of a later global cwd value', async () => {
    const params = await createWith(
      () => {
        $activeGatewayProfile.set('default')
      },
      handle => {
        handle.startFreshSessionDraft({ workspaceTarget: '/clicked-workspace' })
        $currentCwd.set('/project-open-in-file-browser')
      }
    )

    expect(params).toMatchObject({ cwd: '/clicked-workspace' })
  })
})
