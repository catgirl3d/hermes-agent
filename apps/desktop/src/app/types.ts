import type * as React from 'react'

import type { ChatMessage } from '@/lib/chat-messages'
import type { ContextUsageEstimate, SessionMessage, UsageStats } from '@/types/hermes'

export interface ImageAttachResponse {
  attached?: boolean
  path?: string
  text?: string
  message?: string
  // Returned by the byte-upload variant (image.attach_bytes) used in remote mode.
  count?: number
  bytes?: number
  name?: string
  width?: number
  height?: number
  token_estimate?: number
}

export interface ImageDetachResponse {
  detached?: boolean
  count?: number
}

export interface FileAttachResponse {
  attached?: boolean
  message?: string
  // Gateway-side absolute path the file was staged to.
  path?: string
  // Workspace-relative path used to build ref_text.
  ref_path?: string
  // Rewritten @file: ref that resolves on the gateway (workspace-relative).
  ref_text?: string
  // True when bytes/host file were copied into the session workspace.
  uploaded?: boolean
  name?: string
}

export interface SlashExecResponse {
  output?: string
  warning?: string
}

export interface BrowserManageResponse {
  connected?: boolean
  url?: string
  messages?: string[]
}

export interface SessionSteerResponse {
  // 'queued' == accepted into the live turn's steer slot (injected at the next
  // tool-result boundary); 'rejected' == no live tool window, caller queues.
  status?: 'queued' | 'rejected'
  text?: string
}

export interface SessionTitleResponse {
  title?: string
  // True when the session row isn't persisted yet and the title was queued
  // to be applied on the first turn (see tui_gateway session.title handler).
  pending?: boolean
  session_key?: string
}

export interface ToolResultPruneResponse {
  after_bytes: number
  after_tokens: number
  applied: boolean
  before_bytes: number
  before_tokens: number
  changed: boolean
  context_estimate?: ContextUsageEstimate
  duplicate_results: number
  excerpted_results: number
  history_version: number
  messages?: SessionMessage[]
  protected_messages: number
  protected_turns: number
  pruned_results: number
  saved_bytes: number
  saved_tokens: number
  selected_tool_names: string[]
  selection_hash: string
  session_id: string
  /** Renderer-only durable identity captured when this preview was requested. */
  origin_stored_session_id?: string | null
  status: 'preview' | 'pruned' | 'unchanged'
  tools: ToolResultPruneTool[]
  truncated_tool_calls: number
}

export interface ToolResultPruneTool {
  argument_count: number
  compact_kind: 'bounded_excerpt' | 'file_structure' | 'terminal_tail' | 'web_fields'
  default_selected: boolean
  estimated_saved_tokens: number
  name: string
  result_count: number
  selected: boolean
}

export interface HandoffRequestResponse {
  queued?: boolean
  session_key?: string
  platform?: string
  // Human-readable home channel name for the destination platform.
  home_name?: string
}

export interface HandoffStateResponse {
  // '' | 'pending' | 'running' | 'completed' | 'failed'
  state?: string
  platform?: string
  error?: string
}

export interface HandoffFailResponse {
  failed?: boolean
  state?: string
}

export interface ExecCommandDispatchResponse {
  type: 'exec' | 'plugin'
  output?: string
}

export interface AliasCommandDispatchResponse {
  type: 'alias'
  target: string
}

export interface SkillCommandDispatchResponse {
  type: 'skill'
  name: string
  message?: string
}

export interface SendCommandDispatchResponse {
  type: 'send'
  message: string
  notice?: string
}

export interface PrefillCommandDispatchResponse {
  type: 'prefill'
  message: string
  notice?: string
}

export type CommandDispatchResponse =
  | ExecCommandDispatchResponse
  | AliasCommandDispatchResponse
  | SkillCommandDispatchResponse
  | SendCommandDispatchResponse
  | PrefillCommandDispatchResponse

export type SidebarNavId = 'artifacts' | 'command-center' | 'messaging' | 'new-session' | 'settings' | 'skills'

export interface SidebarNavItem {
  /** Built-in view id, or a contributed row's namespaced contribution id. */
  id: SidebarNavId | (string & {})
  label: string
  icon: React.ComponentType<{ className?: string }>
  route?: string
  action?: 'new-session'
  /** Keybind action id — when set, the tooltip shows the keybind hint. */
  keybindActionId?: string
}

export interface ClientSessionState {
  storedSessionId: string | null
  messages: ChatMessage[]
  branch: string
  cwd: string
  model: string
  provider: string
  reasoningEffort: string
  serviceTier: string
  fast: boolean
  yolo: boolean
  personality: string
  busy: boolean
  awaitingResponse: boolean
  streamId: string | null
  sawAssistantPayload: boolean
  pendingBranchGroup: string | null
  interrupted: boolean
  /** True after message.interim finalized a bubble in the still-running turn. */
  interimBoundaryPending: boolean
  /** A blocking clarify prompt is waiting on the user for this session. Drives
   *  the sidebar "needs input" indicator; cleared when the turn resumes/ends. */
  needsInput: boolean
  /** Epoch ms the current turn started, or null when idle. Per-session so a
   *  background turn's elapsed timer keeps counting while another session is
   *  focused, and switching sessions doesn't zero a still-running turn's clock.
   *  The global $turnStartedAt mirrors whichever session is currently viewed. */
  turnStartedAt: number | null
  /** Cumulative token usage, updated per completed turn. Per-session twin of
   *  the primary-only $currentUsage — the statusbar reads it for a focused
   *  tile's context count. Null until the first turn reports. */
  usage: null | UsageStats
}
