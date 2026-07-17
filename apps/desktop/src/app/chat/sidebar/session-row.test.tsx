import { act, cleanup, render, screen } from '@testing-library/react'
import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProjectInfo, SessionInfo } from '@/hermes'
import { $projects } from '@/store/projects'
import { $backgroundStatusBySession } from '@/store/composer-status'
import { $selectedStoredSessionId, $sessions, $unreadFinishedSessionIds } from '@/store/session'
import { $sessionColorById } from '@/store/session-color'
import { $sessionStates } from '@/store/session-states'

import { SidebarSessionRow } from './session-row'

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
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
    tool_call_count: 0,
    ...overrides
  }
}

function project(id: string, path: string, color: string): ProjectInfo {
  return {
    archived: false,
    board_slug: null,
    color,
    created_at: 0,
    description: null,
    folders: [{ added_at: 0, is_primary: true, label: null, path }],
    icon: null,
    id,
    name: id,
    primary_path: path,
    slug: id
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
  $backgroundStatusBySession.set({})
  $selectedStoredSessionId.set(null)
  $unreadFinishedSessionIds.set([])
  $sessionStates.set({})
  $projects.set([])
  $sessions.set([])
})

describe('SidebarSessionRow', () => {
  it('rerenders only rows whose selected, working, or attention status changes', () => {
    const commits: string[] = []
    const onRender: ProfilerOnRenderCallback = id => commits.push(id)

    renderRows(onRender)
    commits.length = 0

    act(() => $selectedStoredSessionId.set('session-a'))

    expect(commits).toEqual(['session-a'])
    expect(screen.getByTestId('session-a').className).toContain('bg-(--ui-row-active-background)')

    commits.length = 0
    act(() => $selectedStoredSessionId.set('session-b'))

    expect(commits).toEqual(expect.arrayContaining(['session-a', 'session-b']))
    expect(commits).toHaveLength(2)

    commits.length = 0
    act(() => $sessionStates.set({ rt1: { busy: true, needsInput: false, storedSessionId: 'session-a' } as never }))

    expect(commits).toEqual(['session-a'])
    expect(screen.getByTestId('session-a').dataset.working).toBe('true')

    commits.length = 0
    act(() => $sessionStates.set({ rt1: { busy: true, needsInput: true, storedSessionId: 'session-a' } as never }))

    expect(commits).toEqual(['session-a'])

    commits.length = 0
    act(() => {
      $sessionStates.set({ rt1: { storedSessionId: 'session-a' } as never })
      $backgroundStatusBySession.set({ rt1: [{ id: 'bg1', state: 'running', title: 'bg', type: 'background' }] })
    })

    expect(commits).toEqual(['session-a'])

    commits.length = 0
    act(() => $unreadFinishedSessionIds.set(['session-a']))

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

    act(() => $selectedStoredSessionId.set('session-a'))

    expect(screen.getByTestId('session-a').className).not.toContain('bg-(--ui-row-active-background)')
  })

  it('rerenders only the row whose resolved session color changes', () => {
    const a = session('session-a', { cwd: '/workspace/a', git_repo_root: '/workspace/a' })
    const b = session('session-b', { cwd: '/workspace/b', git_repo_root: '/workspace/b' })
    const commits: string[] = []
    const onRender: ProfilerOnRenderCallback = id => commits.push(id)

    $sessions.set([a, b])
    $projects.set([project('project-a', '/workspace/a', '#4a9eff'), project('project-b', '/workspace/b', '#7bc86c')])
    renderRows(onRender)
    commits.length = 0

    act(() =>
      $projects.set([project('project-a', '/workspace/a', '#4a9eff'), project('project-b', '/workspace/b', '#f59e0b')])
    )

    expect($sessionColorById.get()).toMatchObject({ [a.id]: '#4a9eff', [b.id]: '#f59e0b' })
    expect(commits).toEqual(['session-b'])
  })
})
