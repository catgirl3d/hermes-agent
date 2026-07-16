// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  onComposerInsertRefsRequest,
  onComposerInsertRequest,
  requestComposerInsert,
  requestComposerInsertRefs
} from './focus'

describe('composer external insert intent', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves explicit user intent on text and ref insert events', () => {
    vi.useFakeTimers()
    const inserts: unknown[] = []
    const refs: unknown[] = []
    const offInsert = onComposerInsertRequest(detail => inserts.push(detail))
    const offRefs = onComposerInsertRefsRequest(detail => refs.push(detail))

    try {
      requestComposerInsert('logs', { intent: 'text', target: 'main' })
      requestComposerInsertRefs(['@file:test.ts'], { intent: 'attachment', target: 'main' })
      vi.runAllTimers()
    } finally {
      offInsert()
      offRefs()
    }

    expect(inserts).toEqual([{ intent: 'text', mode: 'block', target: 'main', text: 'logs' }])
    expect(refs).toEqual([{ intent: 'attachment', refs: ['@file:test.ts'], target: 'main' }])
  })
})
