import { describe, expect, it } from 'vitest'

import {
  buildGroups,
  firstVisibleGroupIndex,
  type MessageGroup,
  nextScrollSettleState,
  restoreScrollTopFromBottom,
  shouldAutoRevealEarlier,
  shouldContinueScrollSettling
} from './list'

// Signature rows are `${index}:${id}:${role}:${weight}` (see the useAuiState
// selector in list.tsx).
const signature = (rows: [string, string, number][]) =>
  rows.map(([id, role, weight], index) => `${index}:${id}:${role}:${weight}`).join('\n')

describe('buildGroups', () => {
  it('returns no groups for an empty signature', () => {
    expect(buildGroups('')).toEqual([])
  })

  it('groups a user message with the assistant turn(s) that follow it', () => {
    const groups = buildGroups(
      signature([
        ['u1', 'user', 1],
        ['a1', 'assistant', 4],
        ['a2', 'assistant', 2],
        ['u2', 'user', 1],
        ['a3', 'assistant', 3]
      ])
    )

    expect(groups).toEqual([
      { id: 'u1', indices: [0, 1, 2], kind: 'turn', weight: 7 },
      { id: 'u2', indices: [3, 4], kind: 'turn', weight: 4 }
    ])
  })

  it('keeps leading non-user messages as standalone groups', () => {
    const groups = buildGroups(
      signature([
        ['s1', 'system', 1],
        ['a0', 'assistant', 2],
        ['u1', 'user', 1],
        ['a1', 'assistant', 5]
      ])
    )

    expect(groups).toEqual([
      { id: 's1', index: 0, kind: 'standalone', weight: 1 },
      { id: 'a0', index: 1, kind: 'standalone', weight: 2 },
      { id: 'u1', indices: [2, 3], kind: 'turn', weight: 6 }
    ])
  })

  it('defaults a missing/zero weight to 1', () => {
    const groups = buildGroups('0:a:assistant:0')

    expect(groups).toEqual([{ id: 'a', index: 0, kind: 'standalone', weight: 1 }])
  })
})

describe('firstVisibleGroupIndex', () => {
  const group = (id: string, weight: number): MessageGroup => ({ id, index: 0, kind: 'standalone', weight })
  const turn = (id: string, weight = 1): MessageGroup => ({ id, indices: [0], kind: 'turn', weight })

  it('shows everything when total weight fits the budget', () => {
    const groups = [group('a', 10), group('b', 10), group('c', 10)]

    expect(firstVisibleGroupIndex(groups, 10, 100)).toBe(0)
  })

  it('walks newest-first and hides everything before the turn that meets the budget', () => {
    const groups = [group('old', 50), group('mid', 30), group('new', 30)]

    // newest-first: 30 (new) < 60, +30 (mid) = 60 >= 60 → mid is the first
    // visible group, old is hidden.
    expect(firstVisibleGroupIndex(groups, 10, 60)).toBe(1)
  })

  it('keeps whole turns intact — the turn that crosses the budget stays visible', () => {
    const groups = [group('old', 5), group('huge', 500)]

    expect(firstVisibleGroupIndex(groups, 10, 60)).toBe(1)
  })

  it('returns groups.length for an empty list', () => {
    expect(firstVisibleGroupIndex([], 1, 300)).toBe(0)
  })

  it('limits the automatic window to the newest two complete turns', () => {
    const groups = Array.from({ length: 9 }, (_, index) => turn(`turn-${index}`))

    expect(firstVisibleGroupIndex(groups, 2, 300)).toBe(7)
  })

  it('keeps adjacent standalone messages with the selected turn', () => {
    const groups = [turn('old'), group('separator', 1), turn('new'), group('tail', 1)]

    expect(firstVisibleGroupIndex(groups, 1, 300)).toBe(1)
  })

  it('reveals one additional complete turn when the window expands', () => {
    const groups = [turn('old'), turn('middle'), turn('new')]

    expect(firstVisibleGroupIndex(groups, 2, 600)).toBe(1)
  })
})

describe('scroll settling', () => {
  it('returns control after two stable scrollHeight frames', () => {
    const afterFirstStableFrame = nextScrollSettleState({ frame: 0, lastHeight: 100, stableFrames: 0 }, 100)
    const afterSecondStableFrame = nextScrollSettleState(afterFirstStableFrame, 100)

    expect(shouldContinueScrollSettling(afterFirstStableFrame)).toBe(true)
    expect(shouldContinueScrollSettling(afterSecondStableFrame)).toBe(false)
  })

  it('stops at the fifteenth changing frame rather than scheduling a sixteenth frame', () => {
    let state = { frame: 0, lastHeight: 0, stableFrames: 0 }

    for (let height = 1; height <= 15; height += 1) {
      state = nextScrollSettleState(state, height)
    }

    expect(state).toEqual({ frame: 15, lastHeight: 15, stableFrames: 0 })
    expect(shouldContinueScrollSettling(state)).toBe(false)
  })
})

describe('earlier-history viewport continuity', () => {
  it('restores the same distance from the viewport bottom after each expansion', () => {
    expect(restoreScrollTopFromBottom(900, 240)).toBe(660)
    expect(restoreScrollTopFromBottom(1_500, 240)).toBe(1_260)
  })
})

describe('shouldAutoRevealEarlier', () => {
  it('reveals only when the user reaches the button while scrolling upward', () => {
    expect(shouldAutoRevealEarlier({ buttonIntersecting: true, expansionPending: false, userScrollIntent: true })).toBe(
      true
    )
  })

  it('does not reveal on initial visibility without user scroll intent', () => {
    expect(
      shouldAutoRevealEarlier({ buttonIntersecting: true, expansionPending: false, userScrollIntent: false })
    ).toBe(false)
  })

  it('does not queue another page while the current expansion is pending', () => {
    expect(shouldAutoRevealEarlier({ buttonIntersecting: true, expansionPending: true, userScrollIntent: true })).toBe(
      false
    )
  })
})
