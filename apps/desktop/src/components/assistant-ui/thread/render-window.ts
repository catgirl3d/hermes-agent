interface RenderWindowGroup {
  kind: 'standalone' | 'turn'
  weight: number
}

export function firstVisibleGroupIndex(
  groups: readonly RenderWindowGroup[],
  visibleTurnLimit: number,
  partBudget: number
): number {
  let firstVisible = groups.length
  let renderedParts = 0
  let renderedTurns = 0

  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]

    if (group.kind === 'turn' && renderedTurns >= visibleTurnLimit) {
      break
    }

    renderedParts += group.weight
    renderedTurns += group.kind === 'turn' ? 1 : 0
    firstVisible = index

    // Keep turns intact even when one tool-heavy turn crosses the part budget.
    if (renderedParts >= partBudget) {
      break
    }
  }

  return firstVisible
}
