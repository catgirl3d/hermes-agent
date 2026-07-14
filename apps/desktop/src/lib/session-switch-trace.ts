type TraceField = boolean | number | string | null | undefined

type TraceFields = Record<string, TraceField>

export type SessionSwitchTraceOutcome = 'cold-resumed' | 'failed' | 'superseded' | 'warm-restored'

export interface SessionSwitchTrace {
  mark: (name: string, fields?: TraceFields) => void
  complete: (outcome: SessionSwitchTraceOutcome, fields?: TraceFields) => void
}

interface SessionSwitchTransportTiming {
  json_serialize_ms?: unknown
  prefix_frame_count?: unknown
  prefix_send_ms?: unknown
  response_send_ms?: unknown
  send_total_ms?: unknown
  stored_session_id?: unknown
}

interface SessionSwitchTraceOptions {
  requestId: number
  storedSessionId: string
}

const SLOW_SWITCH_MS = 250

const activeTraces = new Map<string, Pick<SessionSwitchTrace, 'mark'>>()

/** Records a stage from a renderer boundary that does not own the resume hook. */
export function markActiveSessionSwitchTrace(storedSessionId: string | null, name: string, fields?: TraceFields): void {
  if (storedSessionId) {
    activeTraces.get(storedSessionId)?.mark(name, fields)
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Attaches the post-response server send measurement to the active switch. */
export function recordSessionSwitchTransportTiming(payload: unknown): void {
  if (!payload || typeof payload !== 'object') {
    return
  }

  const timing = payload as SessionSwitchTransportTiming
  const storedSessionId = typeof timing.stored_session_id === 'string' ? timing.stored_session_id : null

  markActiveSessionSwitchTrace(storedSessionId, 'resume-response-sent', {
    backendJsonSerializeMs: finiteNumber(timing.json_serialize_ms),
    backendPrefixFrameCount: finiteNumber(timing.prefix_frame_count),
    backendPrefixSendMs: finiteNumber(timing.prefix_send_ms),
    backendResponseSendMs: finiteNumber(timing.response_send_ms),
    backendSendTotalMs: finiteNumber(timing.send_total_ms)
  })
}

export function measureActiveSessionSwitchTrace<T>(
  storedSessionId: string | null,
  name: string,
  run: () => T,
  fields?: TraceFields | ((result: T) => TraceFields)
): T {
  const startedAt = performance.now()

  try {
    const result = run()
    const extraFields = typeof fields === 'function' ? fields(result) : (fields ?? {})

    markActiveSessionSwitchTrace(storedSessionId, name, {
      operationDurationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      ...extraFields
    })

    return result
  } catch (error) {
    markActiveSessionSwitchTrace(storedSessionId, name, {
      operationDurationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      threw: true
    })
    throw error
  }
}

/**
 * Collects a single session-switch timeline and emits it only after the view is
 * ready. This keeps diagnostic console I/O out of the latency being measured.
 */
export function createSessionSwitchTrace({
  requestId,
  storedSessionId
}: SessionSwitchTraceOptions): SessionSwitchTrace {
  const startedAt = performance.now()
  const stages: Array<{ atMs: number; name: string } & TraceFields> = []
  let completed = false
  let previousStageAt = startedAt

  const mark = (name: string, fields: TraceFields = {}) => {
    if (completed) {
      return
    }

    const markedAt = performance.now()
    const atMs = Math.round((markedAt - startedAt) * 10) / 10
    const sincePreviousStageMs = Math.round((markedAt - previousStageAt) * 10) / 10
    const stageFields = { ...fields }

    delete stageFields.atMs
    delete stageFields.durationMs
    delete stageFields.name
    delete stageFields.sincePreviousStageMs
    previousStageAt = markedAt
    stages.push({ atMs, sincePreviousStageMs, name, ...stageFields })
  }

  const activeTrace = { mark }
  activeTraces.set(storedSessionId, activeTrace)

  return {
    mark,
    complete: (outcome, fields = {}) => {
      if (completed) {
        return
      }

      completed = true
      if (activeTraces.get(storedSessionId) === activeTrace) {
        activeTraces.delete(storedSessionId)
      }

      const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10
      const session =
        storedSessionId.length <= 12 ? storedSessionId : `${storedSessionId.slice(0, 5)}…${storedSessionId.slice(-6)}`
      const summary = {
        elapsedMs,
        outcome,
        requestId,
        session,
        stages,
        ...fields
      }
      const log = elapsedMs >= SLOW_SWITCH_MS ? console.warn : console.info

      console.groupCollapsed(`[session-switch #${requestId}] ${outcome} ${elapsedMs}ms`)
      log(summary)
      console.groupEnd()
    }
  }
}
