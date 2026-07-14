import type { RpcEvent } from '@/types/hermes'

interface AgentBuildTimingPayload {
  duration_ms?: unknown
  error_type?: unknown
  phase?: unknown
  stored_session_id?: unknown
  success?: unknown
  trigger?: unknown
}

export function logAgentBuildTimingEvent(event: RpcEvent): void {
  if (!event.payload || typeof event.payload !== 'object') {
    return
  }

  const payload = event.payload as AgentBuildTimingPayload

  if (payload.phase !== 'started' && payload.phase !== 'finished') {
    return
  }

  console.info(`[agent-build:${payload.phase}]`, {
    backendDurationMs: typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined,
    errorType: typeof payload.error_type === 'string' ? payload.error_type : undefined,
    profile: event.profile,
    sessionId: event.session_id,
    storedSessionId: typeof payload.stored_session_id === 'string' ? payload.stored_session_id : undefined,
    success: typeof payload.success === 'boolean' ? payload.success : undefined,
    trigger: typeof payload.trigger === 'string' ? payload.trigger : 'unspecified'
  })
}
