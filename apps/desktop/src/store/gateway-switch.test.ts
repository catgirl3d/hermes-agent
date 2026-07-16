import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { prepareSessionSnapshot } from '@/lib/session-view-snapshot'
import { $sessionsLimit, resetSessionsLimit, SIDEBAR_SESSIONS_PAGE_SIZE } from '@/store/layout'
import {
  $activeSessionId,
  $cronSessions,
  $freshDraftReady,
  $messagingSessions,
  $messages,
  $sessions,
  $sessionsLoading,
  $sessionsTotal,
  $sessionViewSnapshot,
  publishSessionViewSnapshot,
  setCronSessions,
  setFreshDraftReady,
  setMessagingSessions,
  setSessions,
  setSessionsLoading,
  setSessionsTotal
} from '@/store/session'

import { $gatewaySwitching, wipeSessionListsForGatewaySwitch } from './gateway-switch'

vi.mock('@/lib/query-client', () => ({
  invalidateProfileScopedQueries: vi.fn()
}))

describe('wipeSessionListsForGatewaySwitch', () => {
  beforeEach(() => {
    $gatewaySwitching.set(false)
    publishSessionViewSnapshot(
      prepareSessionSnapshot('runtime-old', {
        ...createClientSessionState('stored-old'),
        messages: [{ id: 'message-old', parts: [{ text: 'old', type: 'text' }], role: 'user' }]
      })
    )
    setSessions([{ id: 's1', title: 'old', profile: 'default' } as never])
    setSessionsTotal(1)
    setCronSessions([{ id: 'c1', title: 'cron', profile: 'default' } as never])
    setMessagingSessions([{ id: 'm1', title: 'tg', profile: 'default' } as never])
    setSessionsLoading(false)
    setFreshDraftReady(false)
    $sessionsLimit.set(SIDEBAR_SESSIONS_PAGE_SIZE * 3)
  })

  afterEach(() => {
    resetSessionsLimit()
    setSessions([])
    setCronSessions([])
    setMessagingSessions([])
    setSessionsLoading(true)
    $gatewaySwitching.set(false)
    publishSessionViewSnapshot(prepareSessionSnapshot(null, createClientSessionState(null)))
  })

  it('clears lists and arms loading so sidebar skeletons retrigger', () => {
    wipeSessionListsForGatewaySwitch()

    expect($sessions.get()).toEqual([])
    expect($sessionsTotal.get()).toBe(0)
    expect($cronSessions.get()).toEqual([])
    expect($messagingSessions.get()).toEqual([])
    expect($sessionsLoading.get()).toBe(true)
    expect($sessionsLimit.get()).toBe(SIDEBAR_SESSIONS_PAGE_SIZE)
    expect($freshDraftReady.get()).toBe(true)
    expect($activeSessionId.get()).toBeNull()
    expect($sessionViewSnapshot.get().runtimeSessionId).toBeNull()
    expect($messages.get()).toEqual([])
  })
})
