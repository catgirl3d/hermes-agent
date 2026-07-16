export type GatewayEventName =
  | 'gateway.ready'
  | 'session.info'
  | 'message.start'
  | 'message.delta'
  | 'message.interim'
  | 'message.complete'
  | 'thinking.delta'
  | 'reasoning.delta'
  | 'reasoning.available'
  | 'status.update'
  | 'tool.start'
  | 'tool.progress'
  | 'tool.complete'
  | 'tool.generating'
  | 'clarify.request'
  | 'approval.request'
  | 'sudo.request'
  | 'secret.request'
  | 'background.complete'
  | 'error'
  | 'skin.changed'
  | (string & {})

export interface GatewayEvent<P = unknown> {
  payload?: P
  /** Renderer-side source tag added by the Desktop gateway registry. */
  profile?: string
  session_id?: string
  type: GatewayEventName
}

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'
export type GatewayRequestId = number | string

export interface JsonRpcFrame {
  error?: { code?: number; message?: string }
  id?: GatewayRequestId | null
  method?: string
  params?: GatewayEvent
  result?: unknown
}

export class JsonRpcGatewayError extends Error {
  readonly code?: number

  constructor(message: string, code?: number) {
    super(message)
    this.name = 'JsonRpcGatewayError'
    this.code = code
  }
}

export function isJsonRpcGatewayError(error: unknown, code?: number): error is JsonRpcGatewayError {
  return error instanceof JsonRpcGatewayError && (code === undefined || error.code === code)
}

export type WebSocketLike = WebSocket

type PendingCall = {
  clientRequestReceiveAckRendererLagMs?: number
  clientRequestSendMs?: number
  rendererLagProbe?: RendererLagProbe
  requestStartedAt?: number
  serverReceiveAckAt?: number
  serverReceiveAckBackendMetrics?: Record<string, number | string>
  serverReceiveAckEventQueueMs?: number
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timer?: ReturnType<typeof setTimeout>
}

export interface GatewayClientOptions {
  closedErrorMessage?: string
  connectErrorMessage?: string
  connectTimeoutMs?: number
  createRequestId?: (nextId: number) => GatewayRequestId
  requestIdPrefix?: string
  requestTimeoutMs?: number
  socketFactory?: (url: string) => WebSocketLike
  notConnectedErrorMessage?: string
}

const ANY = '*'
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const RENDERER_LAG_INTERVAL_MS = 50
// A reconnect after sleep/wake must not hang forever in 'connecting' (which
// keeps the composer disabled and stuck on "Starting Hermes..."). If the open
// handshake doesn't land in this window, fail to 'error' so callers can retry.
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000

interface RendererLagProbe {
  maxLagMs: number
  nextDueAt: number
  timer?: ReturnType<typeof setTimeout>
}

function startRendererLagProbe(): RendererLagProbe {
  const probe: RendererLagProbe = {
    maxLagMs: 0,
    nextDueAt: performance.now() + RENDERER_LAG_INTERVAL_MS
  }

  const tick = () => {
    const now = performance.now()

    probe.maxLagMs = Math.max(probe.maxLagMs, Math.max(0, now - probe.nextDueAt))
    probe.nextDueAt = now + RENDERER_LAG_INTERVAL_MS
    probe.timer = setTimeout(tick, RENDERER_LAG_INTERVAL_MS)
  }

  probe.timer = setTimeout(tick, RENDERER_LAG_INTERVAL_MS)

  return probe
}

function stopRendererLagProbe(probe: RendererLagProbe | undefined): number | undefined {
  if (!probe) {
    return undefined
  }

  if (probe.timer) {
    clearTimeout(probe.timer)
  }
  const lagMs = Math.max(probe.maxLagMs, Math.max(0, performance.now() - probe.nextDueAt))

  return Math.round(lagMs * 100) / 100
}

export class JsonRpcGatewayClient {
  private nextId = 0
  private pending = new Map<GatewayRequestId, PendingCall>()
  private socket: WebSocketLike | null = null
  private state: ConnectionState = 'idle'
  private readonly eventHandlers = new Map<string, Set<(event: GatewayEvent) => void>>()
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>()
  private readonly options: Required<Omit<GatewayClientOptions, 'socketFactory'>> &
    Pick<GatewayClientOptions, 'socketFactory'>

  constructor(options: GatewayClientOptions = {}) {
    this.options = {
      closedErrorMessage: options.closedErrorMessage ?? 'WebSocket closed',
      connectErrorMessage: options.connectErrorMessage ?? 'WebSocket connection failed',
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      createRequestId: options.createRequestId ?? ((nextId: number) => `${options.requestIdPrefix ?? 'r'}${nextId}`),
      notConnectedErrorMessage: options.notConnectedErrorMessage ?? 'gateway not connected',
      requestIdPrefix: options.requestIdPrefix ?? 'r',
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      socketFactory: options.socketFactory
    }
  }

  get connectionState(): ConnectionState {
    return this.state
  }

  async connect(wsUrl: string): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN || this.state === 'connecting') {
      return
    }

    this.setState('connecting')

    const socket = this.options.socketFactory?.(wsUrl) ?? new WebSocket(wsUrl)
    this.socket = socket

    socket.addEventListener('message', message => {
      if (this.socket !== socket) {
        return
      }

      this.handleMessage(message.data, message.timeStamp)
    })

    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return
      }

      this.socket = null
      this.setState('closed')
      this.rejectAllPending(new Error(this.options.closedErrorMessage))
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer)
        }

        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
      }

      const onOpen = () => {
        if (settled || this.socket !== socket) {
          return
        }

        settled = true
        cleanup()
        this.setState('open')
        resolve()
      }

      const onError = () => {
        if (settled || this.socket !== socket) {
          return
        }

        settled = true
        cleanup()
        this.setState('error')
        reject(new Error(this.options.connectErrorMessage))
      }

      socket.addEventListener('open', onOpen, { once: true })
      socket.addEventListener('error', onError, { once: true })

      if (this.options.connectTimeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) {
            return
          }

          settled = true
          cleanup()

          // Drop the half-open socket so the next connect() starts clean
          // instead of short-circuiting on a zombie 'connecting' state.
          if (this.socket === socket) {
            try {
              socket.close()
            } catch {
              // ignore
            }

            this.socket = null
          }

          this.setState('error')
          reject(new Error(this.options.connectErrorMessage))
        }, this.options.connectTimeoutMs)
      }
    })
  }

  close(): void {
    const socket = this.socket

    if (!socket) {
      return
    }

    try {
      socket.close()
    } finally {
      this.socket = null
      this.setState('closed')
      this.rejectAllPending(new Error(this.options.closedErrorMessage))
    }
  }

  on<P = unknown>(type: GatewayEventName, handler: (event: GatewayEvent<P>) => void): () => void {
    let handlers = this.eventHandlers.get(type)

    if (!handlers) {
      handlers = new Set()
      this.eventHandlers.set(type, handlers)
    }

    handlers.add(handler as (event: GatewayEvent) => void)

    return () => handlers?.delete(handler as (event: GatewayEvent) => void)
  }

  onAny(handler: (event: GatewayEvent) => void): () => void {
    return this.on(ANY as GatewayEventName, handler)
  }

  onEvent(handler: (event: GatewayEvent) => void): () => void {
    return this.onAny(handler)
  }

  onState(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler)
    handler(this.state)

    return () => this.stateHandlers.delete(handler)
  }

  request<T>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = this.options.requestTimeoutMs,
    signal?: AbortSignal
  ): Promise<T> {
    const socket = this.socket

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(this.options.notConnectedErrorMessage))
    }

    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    }

    const id = this.options.createRequestId(++this.nextId)
    const requestStartedAt = method === 'session.resume' ? performance.now() : undefined

    return new Promise<T>((resolve, reject) => {
      let onAbort: (() => void) | undefined

      const detach = () => {
        if (onAbort && signal) {
          signal.removeEventListener('abort', onAbort)
        }
      }

      const pending: PendingCall = {
        rendererLagProbe: requestStartedAt === undefined ? undefined : startRendererLagProbe(),
        requestStartedAt,
        resolve: value => {
          detach()
          resolve(value as T)
        },
        reject: error => {
          detach()
          reject(error)
        }
      }

      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          if (this.pending.has(id)) {
            this.clearPending(id)
            detach()
            reject(new Error(`request timed out: ${method}`))
          }
        }, timeoutMs)
      }

      // Abort drops the pending call immediately (no dangling resolver/timer);
      // server-side cancellation is a separate cooperative RPC where it matters.
      if (signal) {
        onAbort = () => {
          const call = this.pending.get(id)

          if (call?.timer) {
            clearTimeout(call.timer)
          }
          this.clearPending(id)
          detach()
          reject(new DOMException('Aborted', 'AbortError'))
        }

        signal.addEventListener('abort', onAbort, { once: true })
      }

      this.pending.set(id, pending)

      try {
        const measureRequestSend = method === 'session.resume'
        const sendStartedAt = measureRequestSend ? performance.now() : 0
        const line = JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params
        })

        socket.send(line)
        if (measureRequestSend) {
          pending.clientRequestSendMs = Math.round((performance.now() - sendStartedAt) * 100) / 100
        }
      } catch (error) {
        this.clearPending(id)
        detach()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private handleMessage(raw: unknown, eventTimestamp?: number): void {
    const text = typeof raw === 'string' ? raw : String(raw)
    let frame: JsonRpcFrame
    const parseStartedAt = performance.now()
    const eventQueueMs = eventTimestamp === undefined ? undefined : parseStartedAt - eventTimestamp

    try {
      frame = JSON.parse(text) as JsonRpcFrame
    } catch {
      return
    }

    if (frame.id !== undefined && frame.id !== null) {
      const call = this.pending.get(frame.id)

      if (!call) {
        return
      }

      this.clearPending(frame.id)

      if (frame.error) {
        call.reject(new JsonRpcGatewayError(frame.error.message || 'Hermes RPC failed', frame.error.code))
      } else {
        const result = frame.result
        const timing =
          result && typeof result === 'object' && 'backend_timing_ms' in result
            ? (result as { backend_timing_ms?: unknown }).backend_timing_ms
            : null

        if (timing && typeof timing === 'object') {
          const metrics = timing as Record<string, number>

          metrics.client_json_parse = Math.round((performance.now() - parseStartedAt) * 100) / 100
          metrics.client_request_send = call.clientRequestSendMs ?? 0
          metrics.response_chars = text.length

          if (call.requestStartedAt !== undefined && call.serverReceiveAckAt !== undefined) {
            const requestReceiveAckMs = call.serverReceiveAckAt - call.requestStartedAt
            const rendererLagMs = call.clientRequestReceiveAckRendererLagMs ?? 0

            metrics.client_request_receive_ack = Math.round(requestReceiveAckMs * 100) / 100
            metrics.client_receive_ack_event_queue = call.serverReceiveAckEventQueueMs ?? 0
            metrics.client_request_receive_ack_renderer_lag = rendererLagMs
            metrics.client_request_receive_ack_transport =
              Math.round(Math.max(0, requestReceiveAckMs - (call.serverReceiveAckEventQueueMs ?? 0)) * 100) / 100
            metrics.client_request_receive_ack_unattributed =
              Math.round(
                Math.max(
                  0,
                  requestReceiveAckMs - (call.serverReceiveAckEventQueueMs ?? 0) - rendererLagMs
                ) * 100
              ) / 100
            metrics.client_receive_ack_to_response =
              Math.round(Math.max(0, parseStartedAt - call.serverReceiveAckAt) * 100) / 100
            Object.assign(metrics, call.serverReceiveAckBackendMetrics)
          }

          if (eventQueueMs !== undefined && eventQueueMs >= 0 && eventQueueMs < DEFAULT_REQUEST_TIMEOUT_MS) {
            metrics.client_message_event_queue = Math.round(eventQueueMs * 100) / 100
          }
        }

        call.resolve(frame.result)
      }

      return
    }

    if (frame.method === 'event' && frame.params?.type) {
      if (frame.params.type === 'gateway.request_received') {
        const payload = frame.params.payload
        const requestId =
          payload && typeof payload === 'object' && 'request_id' in payload
            ? (payload as { request_id?: unknown }).request_id
            : undefined

        if (typeof requestId === 'number' || typeof requestId === 'string') {
          const call = this.pending.get(requestId)

          if (call?.requestStartedAt !== undefined) {
            call.serverReceiveAckAt = performance.now()
            call.clientRequestReceiveAckRendererLagMs = stopRendererLagProbe(call.rendererLagProbe)
            call.rendererLagProbe = undefined
            call.serverReceiveAckBackendMetrics = Object.fromEntries(
              Object.entries(payload as Record<string, unknown>).filter(
                ([key, value]) =>
                  (key.startsWith('backend_agent_build_') && typeof value === 'number') ||
                  (key.startsWith('backend_ws_') && (typeof value === 'number' || typeof value === 'string'))
              )
            ) as Record<string, number | string>
            if (eventQueueMs !== undefined && eventQueueMs >= 0 && eventQueueMs < DEFAULT_REQUEST_TIMEOUT_MS) {
              call.serverReceiveAckEventQueueMs = Math.round(eventQueueMs * 100) / 100
            }
          }
        }

        return
      }

      this.dispatchEvent(frame.params)
    }
  }

  private clearPending(id: GatewayRequestId): void {
    const call = this.pending.get(id)

    if (call?.timer) {
      clearTimeout(call.timer)
    }
    if (call?.rendererLagProbe) {
      stopRendererLagProbe(call.rendererLagProbe)
      call.rendererLagProbe = undefined
    }

    this.pending.delete(id)
  }

  private dispatchEvent(event: GatewayEvent): void {
    for (const handler of this.eventHandlers.get(event.type) ?? []) {
      handler(event)
    }

    for (const handler of this.eventHandlers.get(ANY) ?? []) {
      handler(event)
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, call] of this.pending) {
      this.clearPending(id)
      call.reject(error)
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) {
      return
    }

    this.state = state

    for (const handler of this.stateHandlers) {
      handler(state)
    }
  }
}
