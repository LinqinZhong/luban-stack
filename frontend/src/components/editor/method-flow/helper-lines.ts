import type { GraphNode, NodePositionChange, XYPosition } from '@vue-flow/core'

export type HelperLinesResult = {
  horizontal?: number
  vertical?: number
  snapPosition: Partial<XYPosition>
}

/**
 * 拖拽时计算对齐辅助线与吸附位置（左右/上下/中心对齐）
 * @see https://vueflow.dev/examples/helper-lines.html
 */
export function getHelperLines(
  change: NodePositionChange,
  nodes: GraphNode[],
  distance = 6,
): HelperLinesResult {
  const defaultResult: HelperLinesResult = {
    horizontal: undefined,
    vertical: undefined,
    snapPosition: { x: undefined, y: undefined },
  }
  const nodeA = nodes.find((node) => node.id === change.id)
  if (!nodeA || !change.position) return defaultResult

  const aw = Number(nodeA.dimensions?.width) || 0
  const ah = Number(nodeA.dimensions?.height) || 0
  const nodeABounds = {
    left: change.position.x,
    right: change.position.x + aw,
    top: change.position.y,
    bottom: change.position.y + ah,
    width: aw,
    height: ah,
    centerX: change.position.x + aw / 2,
    centerY: change.position.y + ah / 2,
  }

  let horizontalDistance = distance
  let verticalDistance = distance

  return nodes
    .filter((node) => node.id !== nodeA.id)
    .reduce((result, nodeB) => {
      const bw = Number(nodeB.dimensions?.width) || Number(nodeB.width) || 0
      const bh = Number(nodeB.dimensions?.height) || Number(nodeB.height) || 0
      const nodeBBounds = {
        left: nodeB.position.x,
        right: nodeB.position.x + bw,
        top: nodeB.position.y,
        bottom: nodeB.position.y + bh,
        width: bw,
        height: bh,
        centerX: nodeB.position.x + bw / 2,
        centerY: nodeB.position.y + bh / 2,
      }

      const distanceLeftLeft = Math.abs(nodeABounds.left - nodeBBounds.left)
      if (distanceLeftLeft < verticalDistance) {
        result.snapPosition.x = nodeBBounds.left
        result.vertical = nodeBBounds.left
        verticalDistance = distanceLeftLeft
      }

      const distanceRightRight = Math.abs(nodeABounds.right - nodeBBounds.right)
      if (distanceRightRight < verticalDistance) {
        result.snapPosition.x = nodeBBounds.right - nodeABounds.width
        result.vertical = nodeBBounds.right
        verticalDistance = distanceRightRight
      }

      const distanceLeftRight = Math.abs(nodeABounds.left - nodeBBounds.right)
      if (distanceLeftRight < verticalDistance) {
        result.snapPosition.x = nodeBBounds.right
        result.vertical = nodeBBounds.right
        verticalDistance = distanceLeftRight
      }

      const distanceRightLeft = Math.abs(nodeABounds.right - nodeBBounds.left)
      if (distanceRightLeft < verticalDistance) {
        result.snapPosition.x = nodeBBounds.left - nodeABounds.width
        result.vertical = nodeBBounds.left
        verticalDistance = distanceRightLeft
      }

      const distanceCenterX = Math.abs(nodeABounds.centerX - nodeBBounds.centerX)
      if (distanceCenterX < verticalDistance) {
        result.snapPosition.x = nodeBBounds.centerX - nodeABounds.width / 2
        result.vertical = nodeBBounds.centerX
        verticalDistance = distanceCenterX
      }

      const distanceTopTop = Math.abs(nodeABounds.top - nodeBBounds.top)
      if (distanceTopTop < horizontalDistance) {
        result.snapPosition.y = nodeBBounds.top
        result.horizontal = nodeBBounds.top
        horizontalDistance = distanceTopTop
      }

      const distanceBottomTop = Math.abs(nodeABounds.bottom - nodeBBounds.top)
      if (distanceBottomTop < horizontalDistance) {
        result.snapPosition.y = nodeBBounds.top - nodeABounds.height
        result.horizontal = nodeBBounds.top
        horizontalDistance = distanceBottomTop
      }

      const distanceBottomBottom = Math.abs(
        nodeABounds.bottom - nodeBBounds.bottom,
      )
      if (distanceBottomBottom < horizontalDistance) {
        result.snapPosition.y = nodeBBounds.bottom - nodeABounds.height
        result.horizontal = nodeBBounds.bottom
        horizontalDistance = distanceBottomBottom
      }

      const distanceTopBottom = Math.abs(nodeABounds.top - nodeBBounds.bottom)
      if (distanceTopBottom < horizontalDistance) {
        result.snapPosition.y = nodeBBounds.bottom
        result.horizontal = nodeBBounds.bottom
        horizontalDistance = distanceTopBottom
      }

      const distanceCenterY = Math.abs(nodeABounds.centerY - nodeBBounds.centerY)
      if (distanceCenterY < horizontalDistance) {
        result.snapPosition.y = nodeBBounds.centerY - nodeABounds.height / 2
        result.horizontal = nodeBBounds.centerY
        horizontalDistance = distanceCenterY
      }

      return result
    }, defaultResult)
}
