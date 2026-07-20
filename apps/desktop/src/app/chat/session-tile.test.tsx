import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { $activeSessionId, $selectedStoredSessionId, $sessions } from '@/store/session'
import { $sessionStates, $sessionTiles } from '@/store/session-states'

import type { ClientSessionState } from '../types'

import { SessionTabMenu } from './session-tile'

const STORED_SESSION_ID = 'stored-session'
const RUNTIME_SESSION_ID = 'runtime-session'

function sessionState(busy: boolean, storedSessionId = STORED_SESSION_ID): ClientSessionState {
  return {
    awaitingResponse: false,
    branch: '',
    busy,
    cwd: '',
    fast: false,
    interrupted: false,
    interimBoundaryPending: false,
    messages: [],
    model: '',
    needsInput: false,
    pendingBranchGroup: null,
    personality: '',
    provider: '',
    reasoningEffort: '',
    sawAssistantPayload: false,
    serviceTier: '',
    storedSessionId,
    streamId: null,
    turnStartedAt: null,
    usage: null,
    yolo: false
  }
}

afterEach(() => {
  cleanup()
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $sessions.set([])
  $sessionStates.set({})
  $sessionTiles.set([])
})

describe('SessionTabMenu tool-result pruning', () => {
  it('shows Clean tool outputs for the idle bound workspace session', async () => {
    $activeSessionId.set(RUNTIME_SESSION_ID)
    $selectedStoredSessionId.set(STORED_SESSION_ID)
    $sessionStates.set({ [RUNTIME_SESSION_ID]: sessionState(false) })

    render(
      createElement(SessionTabMenu, {
        children: createElement('button', { type: 'button' }, 'Current session'),
        storedSessionId: STORED_SESSION_ID,
        tabPaneId: 'workspace'
      })
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Current session' }))

    expect(await screen.findByRole('menuitem', { name: 'Clean tool outputs' })).toBeTruthy()
  })

  it('hides Clean tool outputs while the bound session is running', async () => {
    $activeSessionId.set(RUNTIME_SESSION_ID)
    $selectedStoredSessionId.set(STORED_SESSION_ID)
    $sessionStates.set({ [RUNTIME_SESSION_ID]: sessionState(true) })

    render(
      createElement(SessionTabMenu, {
        children: createElement('button', { type: 'button' }, 'Current session'),
        storedSessionId: STORED_SESSION_ID,
        tabPaneId: 'workspace'
      })
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Current session' }))

    expect(screen.queryByRole('menuitem', { name: 'Clean tool outputs' })).toBeNull()
  })

  it('hides Clean tool outputs while the active runtime belongs to another stored session', async () => {
    $activeSessionId.set(RUNTIME_SESSION_ID)
    $selectedStoredSessionId.set(STORED_SESSION_ID)
    $sessionStates.set({ [RUNTIME_SESSION_ID]: sessionState(false, 'other-stored-session') })

    render(
      createElement(SessionTabMenu, {
        children: createElement('button', { type: 'button' }, 'Current session'),
        storedSessionId: STORED_SESSION_ID,
        tabPaneId: 'workspace'
      })
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Current session' }))

    expect(screen.queryByRole('menuitem', { name: 'Clean tool outputs' })).toBeNull()
  })
})
