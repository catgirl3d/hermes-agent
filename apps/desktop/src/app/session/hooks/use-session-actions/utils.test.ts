import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'
import type { SessionInfo } from '@/types/hermes'

import {
  isSessionGoneError,
  reconcileResumeMessages,
  sessionMatchesStoredId,
  sessionShouldHaveTranscript,
  toBranchMessages
} from './utils'

const msg = (id: string, role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role, parts: [{ type: 'text', text }], ...extra }) as ChatMessage

const session = (over: Partial<SessionInfo>): SessionInfo => over as SessionInfo

describe('isSessionGoneError', () => {
  it('is true for 404 / session-not-found, false otherwise', () => {
    expect(isSessionGoneError(new Error('Request failed 404'))).toBe(true)
    expect(isSessionGoneError(new Error('Session not found'))).toBe(true)
    expect(isSessionGoneError(new Error('ECONNREFUSED'))).toBe(false)
    expect(isSessionGoneError(null)).toBe(false)
  })
})

describe('sessionMatchesStoredId', () => {
  it('matches on live id or lineage root', () => {
    expect(sessionMatchesStoredId(session({ id: 'a' }), 'a')).toBe(true)
    expect(sessionMatchesStoredId(session({ id: 'live', _lineage_root_id: 'root' }), 'root')).toBe(true)
    expect(sessionMatchesStoredId(session({ id: 'a' }), 'b')).toBe(false)
  })
})

describe('sessionShouldHaveTranscript', () => {
  it('is true only when the session has messages', () => {
    expect(sessionShouldHaveTranscript(session({ message_count: 3 }))).toBe(true)
    expect(sessionShouldHaveTranscript(session({ message_count: 0 }))).toBe(false)
    expect(sessionShouldHaveTranscript(undefined)).toBe(false)
  })
})

describe('toBranchMessages', () => {
  it('keeps only user/assistant turns that carry text', () => {
    const out = toBranchMessages([
      msg('u', 'user', 'hi'),
      msg('blank', 'assistant', '   '),
      msg('sys', 'system', 'ignored'),
      msg('local', 'assistant', 'renderer note', { rendererOwned: true }),
      msg('a', 'assistant', 'hello')
    ])

    expect(out.map(b => b.source.id)).toEqual(['u', 'a'])
    expect(out[0]).toMatchObject({ content: 'hi', role: 'user' })
  })
})

describe('reconcileResumeMessages', () => {
  it('returns next untouched when there is no previous transcript', () => {
    const next = [msg('1', 'user', 'hi')]
    expect(reconcileResumeMessages(next, [])).toBe(next)
  })

  it('reuses previous message refs when the reconciled turn is unchanged', () => {
    const previous = [msg('u', 'user', 'hi'), msg('a', 'assistant', 'answer')]
    const next = [msg('u', 'user', 'hi'), msg('a', 'assistant', 'answer')]

    const out = reconcileResumeMessages(next, previous)

    expect(out).not.toBe(previous)
    expect(out[0]).toBe(previous[0])
    expect(out[1]).toBe(previous[1])
  })

  it('re-grafts reasoning parts onto a matching assistant turn', () => {
    const next = [msg('a', 'assistant', 'answer')]

    const previous = [
      msg('a', 'assistant', 'answer', {
        parts: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'answer' }
        ]
      } as Partial<ChatMessage>)
    ]

    const [out] = reconcileResumeMessages(next, previous)
    expect(out.parts.some(p => p.type === 'reasoning')).toBe(true)
  })

  it('keeps unchanged message identities when another resume message changed', () => {
    const previous = [
      msg('u-1', 'user', 'first prompt'),
      msg('a-1', 'assistant', 'first answer'),
      msg('u-2', 'user', 'second prompt')
    ]

    const next = [
      msg('u-1', 'user', 'first prompt'),
      msg('a-1', 'assistant', 'updated answer'),
      msg('u-2', 'user', 'second prompt')
    ]

    const out = reconcileResumeMessages(next, previous)

    expect(out[0]).toBe(previous[0])
    expect(out[1]).toBe(next[1])
    expect(out[2]).toBe(previous[2])
  })
})
