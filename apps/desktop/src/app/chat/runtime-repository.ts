import { ExportedMessageRepository, type ThreadMessage } from '@assistant-ui/react'
import { useMemo, useRef } from 'react'

import type { ChatMessage } from '@/lib/chat-messages'
import { coalesceToolOnlyAssistants, createToolMergeCache, toRuntimeMessage } from '@/lib/chat-runtime'
import { measureActiveSessionSwitchTrace } from '@/lib/session-switch-trace'

/**
 * ChatMessage[] -> assistant-ui message repository, with a WeakMap identity
 * cache so unchanged messages convert once (and a tool-merge cache that folds
 * tool-only assistant turns into their neighbour). Shared by the main chat's
 * runtime boundary and session tiles — one transcript pipeline, N surfaces.
 */
export function useRuntimeMessageRepository(
  messages: ChatMessage[],
  traceSessionId: null | string = null
): ExportedMessageRepository {
  const cacheRef = useRef(new WeakMap<ChatMessage, ThreadMessage>())
  const toolMergeCacheRef = useRef(createToolMergeCache())

  return useMemo(() => {
    let coalescedCount = 0
    let headIdPresent = false
    let visibleMessageCount = 0

    return measureActiveSessionSwitchTrace(
      traceSessionId,
      'runtime-message-repository-built',
      () => {
        const items: { message: ThreadMessage; parentId: string | null }[] = []
        const branchParentByGroup = new Map<string, string | null>()
        let visibleParentId: string | null = null
        let headId: string | null = null
        const coalescedMessages = Array.from(coalesceToolOnlyAssistants(messages, toolMergeCacheRef.current))

        coalescedCount = coalescedMessages.length

        for (const message of coalescedMessages) {
          let parentId = visibleParentId

          if (message.role === 'assistant' && message.branchGroupId) {
            if (!branchParentByGroup.has(message.branchGroupId)) {
              branchParentByGroup.set(message.branchGroupId, visibleParentId)
            }

            parentId = branchParentByGroup.get(message.branchGroupId) ?? null
          }

          const cachedMessage = cacheRef.current.get(message)
          const runtimeMessage = cachedMessage ?? toRuntimeMessage(message)

          if (!cachedMessage) {
            cacheRef.current.set(message, runtimeMessage)
          }

          items.push({ message: runtimeMessage, parentId })

          if (!message.hidden) {
            visibleParentId = message.id
            headId = message.id
            visibleMessageCount += 1
          }
        }

        headIdPresent = headId !== null

        return ExportedMessageRepository.fromBranchableArray(items, { headId })
      },
      () => ({
        coalescedCount,
        headIdPresent,
        messageCount: messages.length,
        visibleMessageCount
      })
    )
  }, [messages, traceSessionId])
}
