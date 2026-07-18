import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'

import { group, split } from './model'
import { $collapsedTreeSides, $hiddenTreePanes, $layoutTree, bindTreeSideVisibility, setTreePaneHidden } from './store'

let disposePanes: (() => void) | undefined

beforeEach(() => {
  disposePanes = registry.registerMany([
    { area: 'panes', data: { placement: 'main' }, id: 'workspace' },
    { area: 'panes', data: { placement: 'right' }, id: 'files' }
  ])
  $layoutTree.set(split('row', [group(['workspace']), group(['files'])]))
  $hiddenTreePanes.set(new Set(['files']))
  $collapsedTreeSides.set(new Set())
})

afterEach(() => {
  disposePanes?.()
  disposePanes = undefined
  $layoutTree.set(null)
  $hiddenTreePanes.set(new Set())
  $collapsedTreeSides.set(new Set())
})

describe('setTreePaneHidden', () => {
  it('keeps a collapsed side closed when a pane becomes passively available', () => {
    const openSide = vi.fn()

    bindTreeSideVisibility('right', { get: () => false, listen: () => undefined }, openSide)

    setTreePaneHidden('files', false, false)

    expect($hiddenTreePanes.get().has('files')).toBe(false)
    expect($collapsedTreeSides.get().has('right')).toBe(true)
    expect(openSide).not.toHaveBeenCalled()
  })

  it('opens a collapsed side for an explicit pane reveal', () => {
    const openSide = vi.fn()

    bindTreeSideVisibility('right', { get: () => false, listen: () => undefined }, openSide)

    setTreePaneHidden('files', false)

    expect(openSide).toHaveBeenCalledWith(true)
  })
})
