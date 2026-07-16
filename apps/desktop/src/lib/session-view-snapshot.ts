import type { ClientSessionState } from '@/app/types'

export interface SessionViewSnapshot extends ClientSessionState {
  runtimeSyncMode: 'layout' | 'passive'
  runtimeSessionId: string | null
}

interface SessionViewSnapshotOptions {
  runtimeSyncMode?: SessionViewSnapshot['runtimeSyncMode']
}

/** Builds the complete chat-facing state without mutating renderer stores. */
export function prepareSessionSnapshot(
  runtimeSessionId: string | null,
  state: ClientSessionState,
  options: SessionViewSnapshotOptions = {}
): SessionViewSnapshot {
  return {
    storedSessionId: state.storedSessionId ?? null,
    messages: state.messages ?? [],
    branch: state.branch ?? '',
    cwd: state.cwd ?? '',
    model: state.model ?? '',
    provider: state.provider ?? '',
    reasoningEffort: state.reasoningEffort ?? '',
    serviceTier: state.serviceTier ?? '',
    fast: state.fast ?? false,
    yolo: state.yolo ?? false,
    personality: state.personality ?? '',
    busy: state.busy ?? false,
    awaitingResponse: state.awaitingResponse ?? false,
    streamId: state.streamId ?? null,
    sawAssistantPayload: state.sawAssistantPayload ?? false,
    pendingBranchGroup: state.pendingBranchGroup ?? null,
    interrupted: state.interrupted ?? false,
    needsInput: state.needsInput ?? false,
    turnStartedAt: state.turnStartedAt ?? null,
    usage: state.usage ?? null,
    runtimeSyncMode: options.runtimeSyncMode ?? 'passive',
    runtimeSessionId
  }
}
