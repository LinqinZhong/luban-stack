import { useEffect, useMemo, useState, type Key, type ReactNode } from 'react'
import { Alert, Empty, Tree } from 'antd'
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import { ElMessageBox } from '../../ui/feedback'
import { buildWidgetTree, type TreeNodeData } from '../../utils/widget-tree'
import { STATUS_BAR_NODE_ID } from '../../utils/status-bar'
import {
  canMoveWidget,
  isContainerTag,
  type MovePosition,
} from '../../utils/xml-node'
import { isSlotOutletNodeId, parseSlotOutletNodeId } from '../../utils/slot-outlet'
import type { ComponentRenderMap } from '../../types/component-render'
import RepeatBadge from './RepeatBadge'
import EventBadge from './EventBadge'
import './WidgetTree.css'

function cloneTree(nodes: TreeNodeData[]): TreeNodeData[] {
  return nodes.map((node) => ({
    ...node,
    children: node.children ? cloneTree(node.children) : undefined,
  }))
}

function findAncestorIds(
  nodes: TreeNodeData[],
  id: string,
  trail: string[] = [],
): string[] | null {
  for (const node of nodes) {
    const next = [...trail, node.id]
    if (node.id === id) return next
    if (node.children?.length) {
      const found = findAncestorIds(node.children, id, next)
      if (found) return found
    }
  }
  return null
}

function treeHasId(nodes: TreeNodeData[], id: string): boolean {
  for (const node of nodes) {
    if (node.id === id) return true
    if (node.children?.length && treeHasId(node.children, id)) return true
  }
  return false
}

function collectNodeMap(
  nodes: TreeNodeData[],
  map = new Map<string, TreeNodeData>(),
): Map<string, TreeNodeData> {
  for (const node of nodes) {
    map.set(node.id, node)
    if (node.children?.length) collectNodeMap(node.children, map)
  }
  return map
}

function toAntdTree(nodes: TreeNodeData[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.id,
    title: node.label,
    children: node.children ? toAntdTree(node.children) : undefined,
  }))
}

export default function WidgetTree({
  xml,
  selectedId,
  editable,
  hiddenIds,
  includeStatusBar,
  componentMap,
  onSelect,
  onOpenRepeat,
  onOpenEvent,
  onMove,
  onToggleHidden,
  onContextMenu,
}: {
  xml: string
  selectedId?: string
  editable?: boolean
  hiddenIds?: string[]
  includeStatusBar?: boolean
  componentMap?: ComponentRenderMap
  onSelect?: (id: string) => void
  onOpenRepeat?: (id: string) => void
  onOpenEvent?: (id: string) => void
  onMove?: (payload: {
    sourceId: string
    targetId: string
    position: MovePosition
    slot?: string
  }) => void
  onToggleHidden?: (id: string) => void
  onContextMenu?: (payload: { nodeId: string; x: number; y: number }) => void
}) {
  const [treeData, setTreeData] = useState<TreeNodeData[]>([])
  const [treeError, setTreeError] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([])

  function collectExpandedKeys(
    nodes: TreeNodeData[],
    currentSelectedId?: string,
  ): string[] {
    const keys = new Set(nodes.map((node) => node.id))
    if (currentSelectedId) {
      const ancestors = findAncestorIds(nodes, currentSelectedId)
      if (ancestors) {
        for (const id of ancestors) keys.add(id)
      } else {
        const parts = currentSelectedId.split('/')
        for (let i = 1; i <= parts.length; i += 1) {
          keys.add(parts.slice(0, i).join('/'))
        }
      }
    }
    return Array.from(keys)
  }

  function syncTreeFromXml() {
    const result = buildWidgetTree(xml, {
      includeStatusBar,
      componentMap,
    })
    setTreeError(result.error)
    const next = cloneTree(result.tree)
    setTreeData(next)
    return { error: result.error, tree: next }
  }

  useEffect(() => {
    const { error, tree } = syncTreeFromXml()
    if (!selectedId) return
    if (error) return
    if (!treeHasId(tree, selectedId)) {
      onSelect?.('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml, includeStatusBar, componentMap])

  useEffect(() => {
    setExpandedKeys(collectExpandedKeys(treeData, selectedId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, xml, treeData])

  function isHidden(id: string) {
    return (hiddenIds ?? []).includes(id)
  }

  function handleNodeContextMenu(
    event: React.MouseEvent,
    data: TreeNodeData,
  ) {
    if (!editable) return
    if (data.id === STATUS_BAR_NODE_ID) return
    if (isSlotOutletNodeId(data.id)) return
    event.preventDefault()
    event.stopPropagation()
    onSelect?.(data.id)
    onContextMenu?.({
      nodeId: data.id,
      x: event.clientX,
      y: event.clientY,
    })
  }

  function allowDrag(node: DataNode) {
    if (!editable) return false
    const id = String(node.key)
    if (id === STATUS_BAR_NODE_ID) return false
    if (isSlotOutletNodeId(id)) return false
    return Boolean(id && id.includes('/'))
  }

  const nodeMap = useMemo(() => collectNodeMap(treeData), [treeData])

  function dropPositionOf(dropPosition: number): MovePosition {
    if (dropPosition === -1) return 'before'
    if (dropPosition === 1) return 'after'
    return 'inner'
  }

  function positionLabel(position: MovePosition, targetTag: string): string {
    if (position === 'inner') return `放入「${targetTag}」内部`
    if (position === 'before') return `放到「${targetTag}」前面`
    return `放到「${targetTag}」后面`
  }

  async function handleDrop(info: {
    dragNode: DataNode
    node: DataNode
    dropToGap: boolean
    dropPosition: number
  }) {
    const source = nodeMap.get(String(info.dragNode.key))
    const target = nodeMap.get(String(info.node.key))
    if (!source || !target) return

    let position: MovePosition
    if (!info.dropToGap) {
      position = 'inner'
    } else {
              const dropPos = String(
                (info.node as DataNode & { pos?: string }).pos ?? '',
              ).split('-')
      const gapPos =
        info.dropPosition - Number(dropPos[dropPos.length - 1] ?? 0)
      position = gapPos === -1 ? 'before' : 'after'
    }

    if (isSlotOutletNodeId(target.id) && position === 'inner') {
      const outlet = parseSlotOutletNodeId(target.id)
      if (!outlet) return
      try {
        await ElMessageBox.confirm(
          `确定将「${source.label}」放入插槽「${outlet.slotName}」吗？`,
          '调整控件结构',
          {
            type: 'info',
            confirmButtonText: '确定',
            cancelButtonText: '取消',
          },
        )
      } catch {
        return
      }
      onMove?.({
        sourceId: source.id,
        targetId: outlet.hostId,
        position: 'inner',
        slot: outlet.slotName,
      })
      return
    }

    const invalid = canMoveWidget(source.id, target.id, position, target.tag)
    if (invalid) {
      if (
        position === 'inner' &&
        !isContainerTag(target.tag) &&
        target.tag !== 'Component'
      ) {
        try {
          await ElMessageBox.confirm(
            `「${target.tag}」不支持子节点，是否改为放到其后面？`,
            '无法放入内部',
            {
              type: 'warning',
              confirmButtonText: '放到后面',
              cancelButtonText: '取消',
            },
          )
        } catch {
          return
        }
        onMove?.({
          sourceId: source.id,
          targetId: target.id,
          position: 'after',
        })
        return
      }
      return
    }

    try {
      await ElMessageBox.confirm(
        `确定将「${source.label}」${positionLabel(position, target.tag)}吗？`,
        '调整控件结构',
        {
          type: 'info',
          confirmButtonText: '确定',
          cancelButtonText: '取消',
        },
      )
    } catch {
      return
    }

    onMove?.({
      sourceId: source.id,
      targetId: target.id,
      position,
    })
  }

  const antdTreeData = useMemo(() => toAntdTree(treeData), [treeData])

  return (
    <div className="widget-tree">
      <div className="tree-header">控件树</div>
      <div className="tree-body">
        {treeError ? (
          <Alert type="error" showIcon closable={false} message={treeError} />
        ) : !treeData.length ? (
          <Empty description="暂无节点" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Tree
            treeData={antdTreeData}
            blockNode
            showIcon={false}
            selectedKeys={selectedId ? [selectedId] : []}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys)}
            expandAction={false}
            draggable={
              editable
                ? { icon: false, nodeDraggable: (node) => allowDrag(node) }
                : false
            }
            allowDrop={({ dropNode, dragNode, dropPosition }) => {
              if (!editable) return false
              const sourceId = String(dragNode.key)
              const target = nodeMap.get(String(dropNode.key))
              if (!target) return false
              if (target.id === STATUS_BAR_NODE_ID || sourceId === STATUS_BAR_NODE_ID) {
                return false
              }
              if (isSlotOutletNodeId(sourceId)) return false
              const position = dropPositionOf(dropPosition)
              if (isSlotOutletNodeId(target.id)) {
                return position === 'inner'
              }
              if (
                position === 'inner' &&
                !isContainerTag(target.tag) &&
                target.tag !== 'Component'
              ) {
                return canMoveWidget(sourceId, target.id, 'after', target.tag) === null
              }
              return canMoveWidget(sourceId, target.id, position, target.tag) === null
            }}
            onSelect={(keys) => {
              const id = String(keys[0] ?? '')
              if (id) onSelect?.(id)
            }}
            onDrop={(info) => {
              void handleDrop(info)
            }}
            titleRender={(node) => {
              const data = nodeMap.get(String(node.key))
              if (!data) return node.title as ReactNode
              return (
                <div
                  className={`tree-node${isHidden(data.id) ? ' is-hidden' : ''}`}
                  onContextMenu={(event) => handleNodeContextMenu(event, data)}
                >
                  <span className="tree-label">{data.label}</span>
                  {(data.eventBindingCount ?? 0) > 0 ? (
                    <EventBadge
                      size={14}
                      count={data.eventBindingCount}
                      clickable
                      onClick={() => onOpenEvent?.(data.id)}
                    />
                  ) : null}
                  {data.hasRepeat ? (
                    <RepeatBadge
                      size={14}
                      clickable
                      onClick={() => onOpenRepeat?.(data.id)}
                    />
                  ) : null}
                  {editable &&
                  data.id !== STATUS_BAR_NODE_ID &&
                  !isSlotOutletNodeId(data.id) ? (
                    <button
                      type="button"
                      className="eye-btn"
                      title={
                        isHidden(data.id)
                          ? '显示（仅编辑态，占位保留）'
                          : '隐藏（仅编辑态，占位保留）'
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleHidden?.(data.id)
                      }}
                    >
                      {isHidden(data.id) ? (
                        <EyeInvisibleOutlined style={{ fontSize: 14 }} />
                      ) : (
                        <EyeOutlined style={{ fontSize: 14 }} />
                      )}
                    </button>
                  ) : null}
                </div>
              )
            }}
          />
        )}
      </div>
    </div>
  )
}
