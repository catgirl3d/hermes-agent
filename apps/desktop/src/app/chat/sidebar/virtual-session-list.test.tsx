import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'

const shared = vi.hoisted(() => ({
  measureElement: vi.fn(),
  setNodeRef: vi.fn()
}))

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: { 'data-sortable': 'true' },
    isDragging: false,
    listeners: { onPointerDown: vi.fn() },
    setNodeRef: shared.setNodeRef,
    transform: null,
    transition: null
  })
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 100,
    getVirtualItems: () => [
      { index: 0, start: 0, end: 28 },
      { index: 1, start: 28, end: 56 }
    ],
    measureElement: shared.measureElement
  })
}))

vi.mock('./session-row', async () => {
  const React = await import('react')

  return {
    SidebarSessionRow: React.forwardRef<HTMLDivElement, any>((props, ref) => (
      <div
        ref={ref}
        data-index={props['data-index']}
        data-reorderable={String(Boolean(props.reorderable))}
        data-testid={props.session.id}
      >
        {props.session.id}
      </div>
    ))
  }
})

import { VirtualSessionList } from './virtual-session-list'

function session(id: string): SessionInfo {
  return {
    archived: false,
    cwd: null,
    ended_at: null,
    id,
    _lineage_root_id: null,
    input_tokens: 0,
    is_active: false,
    last_active: 0,
    message_count: 1,
    model: null,
    output_tokens: 0,
    preview: null,
    profile: 'default',
    source: null,
    started_at: 0,
    title: id,
    tool_call_count: 0
  }
}

describe('VirtualSessionList', () => {
  afterEach(() => {
    shared.measureElement.mockClear()
    shared.setNodeRef.mockClear()
  })

  it('keeps its own scroller and marks only unbranched rows reorderable', () => {
    const { container } = render(
      <VirtualSessionList
        entries={[
          { session: session('session-a') },
          { branchStem: '└─ ', session: session('session-b') }
        ]}
        onArchiveSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onResumeSession={vi.fn()}
        onTogglePin={vi.fn()}
        pinned={false}
        showSelection
        sortable
      />
    )

    const scroller = container.firstElementChild as HTMLElement | null
    const content = scroller?.firstElementChild as HTMLElement | null

    expect(scroller?.className).toContain('overflow-y-auto')
    expect(content?.style.paddingTop).toBe('0px')
    expect(content?.style.paddingBottom).toBe('44px')
    expect(screen.getByTestId('session-a').getAttribute('data-index')).toBe('0')
    expect(screen.getByTestId('session-a').getAttribute('data-reorderable')).toBe('true')
    expect(screen.getByTestId('session-b').getAttribute('data-index')).toBe('1')
    expect(screen.getByTestId('session-b').getAttribute('data-reorderable')).toBe('false')
    expect(shared.setNodeRef).toHaveBeenCalled()
    expect(shared.measureElement).toHaveBeenCalled()
  })
})
