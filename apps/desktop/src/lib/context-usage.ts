import type { ContextUsageEstimate, UsageStats } from '@/types/hermes'

export function mergeContextUsage(
  usage: UsageStats | null,
  contextEstimate: ContextUsageEstimate | undefined
): UsageStats | null {
  if (!contextEstimate) {
    return usage
  }

  return {
    calls: 0,
    input: 0,
    output: 0,
    total: 0,
    ...usage,
    ...contextEstimate
  }
}
