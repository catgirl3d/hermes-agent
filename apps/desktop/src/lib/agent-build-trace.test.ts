import { afterEach, describe, expect, it, vi } from 'vitest'

import { logAgentBuildTimingEvent } from './agent-build-trace'

describe('agent build trace', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs backend-measured prompt build completion', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    logAgentBuildTimingEvent({
      type: 'agent.build_timing',
      session_id: 'runtime-1',
      profile: 'default',
      payload: {
        phase: 'finished',
        trigger: 'prompt_submit',
        duration_ms: 842.35,
        success: true,
        error_type: null,
        stored_session_id: 'stored-1'
      }
    })

    expect(info).toHaveBeenCalledWith('[agent-build:finished]', {
      backendDurationMs: 842.35,
      errorType: undefined,
      profile: 'default',
      sessionId: 'runtime-1',
      storedSessionId: 'stored-1',
      success: true,
      trigger: 'prompt_submit'
    })
  })

  it('ignores malformed timing events', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    logAgentBuildTimingEvent({ type: 'agent.build_timing', payload: { phase: 'other' } })

    expect(info).not.toHaveBeenCalled()
  })
})
