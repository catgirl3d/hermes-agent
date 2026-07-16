import { act, cleanup, render, screen } from '@testing-library/react'
import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'
import { $attentionSessionIds, $focusedStoredSessionId, $workingSessionIds } from '@/store/session-states'

import { SidebarSessionRow } from './session-row'

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

function renderRows(onRender: ProfilerOnRenderCallback) {
  const rowProps = {
    isPinned: false,
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onPin: vi.fn(),
    onResume: vi.fn()
  }

  return render(
    <>
      <Profiler id="session-a" onRender={onRender}>
        <SidebarSessionRow data-testid="session-a" session={session('session-a')} {...rowProps} />
      </Profiler>
      <Profiler id="session-b" onRender={onRender}>
        <SidebarSessionRow data-testid="session-b" session={session('session-b')} {...rowProps} />
      </Profiler>
    </>
  )
}

afterEach(() => {
  cleanup()
  $attentionSessionIds.set([])
  $focusedStoredSessionId.set(null)
  $workingSessionIds.set([])
})

describe('SidebarSessionRow', () => {
  it('rerenders only rows whose selected, working, or attention status changes', () => {
    const commits: string[] = []
    const onRender: ProfilerOnRenderCallback = id => commits.push(id)

    renderRows(onRender)
    commits.length = 0

    act(() => $focusedStoredSessionId.set('session-a'))

    expect(commits).toEqual(['session-a'])
    expect(screen.getByTestId('session-a').className).toContain('bg-(--ui-row-active-background)')

    commits.length = 0
    act(() => $focusedStoredSessionId.set('session-b'))

    expect(commits).toEqual(expect.arrayContaining(['session-a', 'session-b']))
    expect(commits).toHaveLength(2)

    commits.length = 0
    act(() => $workingSessionIds.set(['session-a']))

    expect(commits).toEqual(['session-a'])
    expect(screen.getByTestId('session-a').dataset.working).toBe('true')

    commits.length = 0
    act(() => $attentionSessionIds.set(['session-a']))

    expect(commits).toEqual(['session-a'])
  })

  it('does not highlight the selected session outside the chat view', () => {
    render(
      <SidebarSessionRow
        data-testid="session-a"
        isPinned={false}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onPin={vi.fn()}
        onResume={vi.fn()}
        session={session('session-a')}
        showSelection={false}
      />
    )

    act(() => $focusedStoredSessionId.set('session-a'))

    expect(screen.getByTestId('session-a').className).not.toContain('bg-(--ui-row-active-background)')
  })
})
