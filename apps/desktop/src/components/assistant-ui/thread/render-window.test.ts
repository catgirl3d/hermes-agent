import { describe, expect, it } from 'vitest'

import { firstVisibleGroupIndex } from './render-window'

const turn = (weight = 1) => ({ kind: 'turn' as const, weight })
const standalone = (weight = 1) => ({ kind: 'standalone' as const, weight })

describe('firstVisibleGroupIndex', () => {
  it('limits the initial window to the last turn', () => {
    const groups = Array.from({ length: 9 }, () => turn())

    expect(firstVisibleGroupIndex(groups, 1, 300)).toBe(8)
  })

  it('includes standalone messages inside the selected turn window', () => {
    const groups = [standalone(), turn(), standalone(), turn(), turn()]

    expect(firstVisibleGroupIndex(groups, 1, 300)).toBe(4)
  })

  it('keeps a turn intact when it crosses the part budget', () => {
    const groups = [turn(), turn(350)]

    expect(firstVisibleGroupIndex(groups, 1, 300)).toBe(1)
  })

  it('reveals an additional turn when the window expands', () => {
    const groups = [turn(), turn(), turn()]

    expect(firstVisibleGroupIndex(groups, 2, 600)).toBe(1)
  })
})
