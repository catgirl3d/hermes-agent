import { describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/hermes'

import { runtimeMatchesStoredSession, sameCronSignature } from './desktop-controller-utils'

const session = (id: string, title: string | null): SessionInfo => ({ id, title }) as SessionInfo

describe('runtimeMatchesStoredSession', () => {
  it('rejects a poll targeting a stored session not owned by the active runtime', () => {
    expect(runtimeMatchesStoredSession('stored-A', 'stored-B')).toBe(false)
    expect(runtimeMatchesStoredSession(undefined, 'stored-A')).toBe(false)
  })

  it('accepts the runtime currently bound to the selected stored session', () => {
    expect(runtimeMatchesStoredSession('stored-A', 'stored-A')).toBe(true)
  })
})

describe('sameCronSignature', () => {
  it('is false when the lengths differ', () => {
    expect(sameCronSignature([session('a', 't')], [])).toBe(false)
  })

  it('is true when ids and titles match in order', () => {
    const a = [session('a', 'one'), session('b', 'two')]
    const b = [session('a', 'one'), session('b', 'two')]
    expect(sameCronSignature(a, b)).toBe(true)
  })

  it('is false when a title changed', () => {
    const a = [session('a', 'one')]
    const b = [session('a', 'renamed')]
    expect(sameCronSignature(a, b)).toBe(false)
  })

  it('is false when order differs', () => {
    const a = [session('a', 't'), session('b', 't')]
    const b = [session('b', 't'), session('a', 't')]
    expect(sameCronSignature(a, b)).toBe(false)
  })
})
