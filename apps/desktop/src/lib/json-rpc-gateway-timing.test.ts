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
          backend_agent_build_active_max_elapsed_ms: 275
        }
      }
    }
    const response = {
      id: req.id,
      result: {
        backend_timing_ms: {
          handler_total: 5,
          schema_version: 11,
          resume_prewarm_enabled: 0,
          resume_prewarm_mode: 'on_demand',
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
    const result = await client.request<{
      backend_timing_ms: {
        backend_agent_build_active_count?: number
        backend_agent_build_active_max_elapsed_ms?: number
        client_json_parse?: number
        client_message_event_queue?: number
        client_receive_ack_event_queue?: number
        client_receive_ack_to_response?: number
        client_request_receive_ack?: number
        client_request_receive_ack_transport?: number
        client_request_send?: number
        response_chars?: number
        resume_prewarm_mode?: string
        ws_ack_send?: number
        ws_receive_to_ack?: number
      }
      ok: boolean
    }>('session.resume')

    expect(result.ok).toBe(true)
    expect(result.backend_timing_ms.backend_agent_build_active_count).toBe(1)
    expect(result.backend_timing_ms.backend_agent_build_active_max_elapsed_ms).toBe(275)
    expect(result.backend_timing_ms.client_json_parse).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.client_message_event_queue).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.client_receive_ack_event_queue).toBeGreaterThanOrEqual(9)
    expect(result.backend_timing_ms.client_receive_ack_to_response).toBeGreaterThanOrEqual(5)
    expect(result.backend_timing_ms.client_request_receive_ack).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.client_request_receive_ack_transport).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.client_request_send).toBeGreaterThanOrEqual(0)
    expect(result.backend_timing_ms.response_chars).toBeGreaterThan(0)
    expect(result.backend_timing_ms.resume_prewarm_mode).toBe('on_demand')
    expect(result.backend_timing_ms.ws_ack_send).toBe(1.5)
    expect(result.backend_timing_ms.ws_receive_to_ack).toBe(0.2)
  })
})
