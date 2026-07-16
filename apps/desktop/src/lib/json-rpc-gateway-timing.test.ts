import { JsonRpcGatewayClient } from '@hermes/shared'
import { describe, expect, it } from 'vitest'

type Listener = (event: { data?: string; timeStamp?: number }) => void

class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3

  readyState = 0
  private listeners: Record<string, Set<Listener>> = {}

  constructor() {
    setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN
      this.emit('open', {})
    }, 0)
  }

  addEventListener(type: string, fn: Listener) {
    ;(this.listeners[type] ??= new Set()).add(fn)
  }

  removeEventListener(type: string, fn: Listener) {
    this.listeners[type]?.delete(fn)
  }

  send(line: string) {
    const req = JSON.parse(line) as { id: string }

    const ack = {
      method: 'event',
      params: {
        type: 'gateway.request_received',
        payload: {
          request_id: req.id,
          backend_agent_build_active_count: 1,
          backend_agent_build_active_max_elapsed_ms: 275,
          backend_ws_event_loop_lag_ms: 2.5,
          backend_ws_previous_dispatch_ms: 125,
          backend_ws_previous_method: 'commands.catalog',
          backend_ws_previous_request_finished_ago_ms: 0.4,
          backend_ws_previous_request_ms: 126
        }
      }
    }

    const response = {
      id: req.id,
      result: {
        backend_timing_ms: {
          handler_total: 5,
          schema_version: 12,
          resume_prewarm_enabled: 0,
          resume_prewarm_mode: 'composer_intent',
          ws_ack_send: 1.5,
          ws_receive_to_ack: 0.2
        },
        ok: true
      }
    }

    setTimeout(() => {
      this.emit('message', { data: JSON.stringify(ack), timeStamp: performance.now() - 10 })
      setTimeout(() => {
        this.emit('message', { data: JSON.stringify(response), timeStamp: performance.now() })
      }, 10)
    }, 0)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', {})
  }

  private emit(type: string, event: { data?: string; timeStamp?: number }) {
    for (const fn of this.listeners[type] ?? []) {
      fn(event)
    }
  }
}

describe('JsonRpcGatewayClient timing instrumentation', () => {
  it('annotates backend timing with client parse cost and response size', async () => {
    const client = new JsonRpcGatewayClient({
      socketFactory: () => new FakeWebSocket() as unknown as WebSocket
    })

    await client.connect('ws://example.test')

    const request = client.request<{
      backend_timing_ms: {
        backend_agent_build_active_count?: number
        backend_agent_build_active_max_elapsed_ms?: number
        backend_ws_event_loop_lag_ms?: number
        backend_ws_previous_dispatch_ms?: number
        backend_ws_previous_method?: string
        backend_ws_previous_request_finished_ago_ms?: number
        backend_ws_previous_request_ms?: number
        client_json_parse?: number
        client_message_event_queue?: number
        client_receive_ack_event_queue?: number
        client_receive_ack_to_response?: number
        client_request_receive_ack?: number
        client_request_receive_ack_renderer_lag?: number
        client_request_receive_ack_transport?: number
        client_request_receive_ack_unattributed?: number
        client_request_send?: number
        response_chars?: number
        resume_prewarm_mode?: string
        ws_ack_send?: number
        ws_receive_to_ack?: number
      }
      ok: boolean
    }>('session.resume')

    const blockedAt = performance.now()
    let spinCount = 0

    while (performance.now() - blockedAt < 70) {
      spinCount += 1
    }

    const result = await request

    expect(spinCount).toBeGreaterThan(0)
    expect(result.ok).toBe(true)
    expect(result.backend_timing_ms.backend_agent_build_active_count).toBe(1)
    expect(result.backend_timing_ms.backend_agent_build_active_max_elapsed_ms).toBe(275)
    expect(result.backend_timing_ms.backend_ws_event_loop_lag_ms).toBe(2.5)
    expect(result.backend_timing_ms.backend_ws_previous_dispatch_ms).toBe(125)
    expect(result.backend_timing_ms.backend_ws_previous_method).toBe('commands.catalog')
    expect(result.backend_timing_ms.backend_ws_previous_request_finished_ago_ms).toBe(0.4)
    expect(result.backend_timing_ms.backend_ws_previous_request_ms).toBe(126)
    expect(result.backend_timing_ms.client_json_parse).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.client_message_event_queue).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.client_receive_ack_event_queue).toBeGreaterThanOrEqual(9)
    expect(result.backend_timing_ms.client_receive_ack_to_response).toBeGreaterThanOrEqual(5)
    expect(result.backend_timing_ms.client_request_receive_ack).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.client_request_receive_ack_renderer_lag).toBeGreaterThanOrEqual(15)
    expect(result.backend_timing_ms.client_request_receive_ack_transport).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.client_request_receive_ack_unattributed).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.client_request_send).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.response_chars).toBeGreaterThan(0)
    expect(result.backend_timing_ms.resume_prewarm_mode).toBe('composer_intent')
    expect(result.backend_timing_ms.ws_ack_send).toBe(1.5)
    expect(result.backend_timing_ms.ws_receive_to_ack).toBe(0.2)
  })
})
