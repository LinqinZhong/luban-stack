import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Input, Modal, Select, Spin } from 'antd'
import {
  FileOutlined,
  FolderOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import {
  getOssLibrary,
  getOssObjectMeta,
  listOssBuckets,
  listOssObjects,
  signOssObject,
} from '../../api/projects'
import type { OssBindingConfig } from '../../types/page-data'
import type {
  OssBucketInfo,
  OssConnectionConfig,
  OssConnectionPayload,
  OssObjectInfo,
} from '../../types/oss'
import './OssResourcePickerDialog.css'

export default function OssResourcePickerDialog({
  open,
  onOpenChange,
  projectPath,
  initial,
  allowCustomKey,
  suggestedKey,
  title,
  onConfirm,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  projectPath?: string | null
  initial?: OssBindingConfig | null
  allowCustomKey?: boolean
  suggestedKey?: string
  title?: string
  onConfirm?: (config: OssBindingConfig) => void
}) {
  const [loading, setLoading] = useState(false)
  const [listing, setListing] = useState(false)
  const [connections, setConnections] = useState<OssConnectionConfig[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [bucketName, setBucketName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [keyQuery, setKeyQuery] = useState('')
  const [entries, setEntries] = useState<OssObjectInfo[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [selectedUrl, setSelectedUrl] = useState('')
  const [metaLoading, setMetaLoading] = useState(false)
  const [signedThumbMap, setSignedThumbMap] = useState<Record<string, string>>({})
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(() => new Set())
  const hydrating = useRef(false)
  const skipConnWatch = useRef(true)
  const skipBucketWatch = useRef(true)

  const dialogTitle = title || '选择对象存储资源'

  const activeConnection = useMemo(
    () => connections.find((c) => c.id === connectionId) ?? null,
    [connections, connectionId],
  )

  const connectionPayload = useMemo<OssConnectionPayload | null>(() => {
    if (!activeConnection) return null
    return {
      endpoint: activeConnection.endpoint,
      region: activeConnection.region,
      accessKeyId: activeConnection.accessKeyId,
      secretAccessKey: activeConnection.secretAccessKey,
      forcePathStyle: activeConnection.forcePathStyle,
    }
  }, [activeConnection])

  const buckets = useMemo<OssBucketInfo[]>(
    () => activeConnection?.buckets ?? [],
    [activeConnection],
  )

  const activeBucket = useMemo(
    () => buckets.find((b) => b.name === bucketName) ?? null,
    [buckets, bucketName],
  )

  const isPrivateBucket = activeBucket?.access !== 'public'

  const breadcrumb = useMemo(() => {
    const parts = prefix.split('/').filter(Boolean)
    const items: { label: string; prefix: string }[] = [
      { label: bucketName || '桶', prefix: '' },
    ]
    let acc = ''
    for (const part of parts) {
      acc += `${part}/`
      items.push({ label: part, prefix: acc })
    }
    return items
  }, [prefix, bucketName])

  const canConfirm = Boolean(
    connectionId && bucketName && selectedKey.trim() && (selectedUrl || allowCustomKey),
  )

  function displayName(row: OssObjectInfo): string {
    const key = row.key
    if (row.isPrefix) {
      const trimmed = key.endsWith('/') ? key.slice(0, -1) : key
      const parts = trimmed.split('/')
      return parts[parts.length - 1] || key
    }
    if (prefix && key.startsWith(prefix)) {
      return key.slice(prefix.length)
    }
    const parts = key.split('/')
    return parts[parts.length - 1] || key
  }

  function isImageKey(key: string): boolean {
    return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(key)
  }

  function thumbSrc(key: string): string | undefined {
    if (failedThumbs.has(key)) return undefined
    if (isPrivateBucket) return signedThumbMap[key]
    return buildPublicUrl(key) || undefined
  }

  function showImageThumb(row: OssObjectInfo): boolean {
    return !row.isPrefix && isImageKey(row.key) && Boolean(thumbSrc(row.key))
  }

  function buildPublicUrl(key: string, payload = connectionPayload): string | null {
    if (!payload?.endpoint || !bucketName) return null
    const endpoint = payload.endpoint.trim().replace(/\/+$/, '')
    const encodedKey = key
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')
    try {
      if (payload.forcePathStyle !== false) {
        return `${endpoint}/${bucketName}/${encodedKey}`
      }
      const url = new URL(endpoint)
      return `${url.protocol}//${bucketName}.${url.host}/${encodedKey}`
    } catch {
      return `${endpoint}/${bucketName}/${encodedKey}`
    }
  }

  async function refreshSignedThumbs(
    rows: OssObjectInfo[],
    payload: OssConnectionPayload | null,
    bucket: string,
    privateBucket: boolean,
  ) {
    if (!payload || !bucket || !privateBucket) {
      setSignedThumbMap({})
      return
    }
    const images = rows.filter((r) => !r.isPrefix && isImageKey(r.key))
    const next: Record<string, string> = {}
    await Promise.all(
      images.map(async (row) => {
        try {
          const result = await signOssObject({
            ...payload,
            bucketName: bucket,
            key: row.key,
          })
          next[row.key] = result.signedUrl
        } catch {
          // ignore thumb failures
        }
      }),
    )
    setSignedThumbMap(next)
  }

  function onThumbError(key: string) {
    setFailedThumbs((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }

  async function loadLibrary(): Promise<OssConnectionConfig[]> {
    const path = projectPath?.trim()
    if (!path) {
      setConnections([])
      return []
    }
    setLoading(true)
    try {
      const lib = await getOssLibrary(path)
      const list = lib.connections ?? []
      setConnections(list)
      return list
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '加载对象存储失败')
      setConnections([])
      return []
    } finally {
      setLoading(false)
    }
  }

  async function refreshBuckets(
    payload: OssConnectionPayload | null,
    connId: string,
  ): Promise<OssBucketInfo[]> {
    if (!payload) return []
    try {
      const result = await listOssBuckets(payload)
      setConnections((prev) =>
        prev.map((c) => (c.id === connId ? { ...c, buckets: result.buckets } : c)),
      )
      return result.buckets
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '列出桶失败')
      return []
    }
  }

  async function loadObjects(
    payload: OssConnectionPayload | null,
    bucket: string,
    nextPrefix: string,
  ) {
    if (!payload || !bucket) {
      setEntries([])
      setSignedThumbMap({})
      return
    }
    setListing(true)
    try {
      const result = await listOssObjects({
        ...payload,
        bucketName: bucket,
        prefix: nextPrefix || undefined,
      })
      const nextEntries = [...(result.prefixes ?? []), ...(result.objects ?? [])]
      setEntries(nextEntries)
      setSignedThumbMap({})
      setFailedThumbs(new Set())
      const privateBucket =
        payload &&
        (connections.find((c) => c.id === connectionId)?.buckets ?? []).find(
          (b) => b.name === bucket,
        )?.access !== 'public'
      void refreshSignedThumbs(nextEntries, payload, bucket, privateBucket)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '列出对象失败')
      setEntries([])
      setSignedThumbMap({})
      setFailedThumbs(new Set())
    } finally {
      setListing(false)
    }
  }

  function runSearch() {
    const q = keyQuery.trim()
    let nextPrefix = ''
    if (!q) {
      nextPrefix = ''
    } else if (q.endsWith('/')) {
      nextPrefix = q
    } else if (q.includes('/')) {
      const slash = q.lastIndexOf('/')
      nextPrefix = q.slice(0, slash + 1)
    } else {
      nextPrefix = q
    }
    setPrefix(nextPrefix)
    if (!allowCustomKey) {
      setSelectedKey('')
      setSelectedUrl('')
    } else if (q && !q.endsWith('/')) {
      setSelectedKey(q)
      setSelectedUrl(buildPublicUrl(q) || '')
    }
    void loadObjects(connectionPayload, bucketName, nextPrefix).then(() => {
      if (!q || q.endsWith('/')) return
      setEntries((current) => {
        const hit = current.find((e) => !e.isPrefix && e.key === q)
        if (hit) void selectObject(hit)
        return current
      })
    })
  }

  async function selectObject(row: OssObjectInfo) {
    if (row.isPrefix) {
      const nextPrefix = row.key.endsWith('/') ? row.key : `${row.key}/`
      setPrefix(nextPrefix)
      setKeyQuery(nextPrefix)
      setSelectedKey('')
      setSelectedUrl('')
      await loadObjects(connectionPayload, bucketName, nextPrefix)
      return
    }
    setSelectedKey(row.key)
    setKeyQuery(row.key)
    setSelectedUrl(buildPublicUrl(row.key) || '')
    if (!connectionPayload) return
    setMetaLoading(true)
    try {
      const meta = await getOssObjectMeta({
        ...connectionPayload,
        bucketName,
        key: row.key,
      })
      if (meta.publicUrl) setSelectedUrl(meta.publicUrl)
    } catch {
      // 保留本地拼出的外链
    } finally {
      setMetaLoading(false)
    }
  }

  function goPrefix(next: string) {
    setPrefix(next)
    setKeyQuery(next)
    setSelectedKey('')
    setSelectedUrl('')
    void loadObjects(connectionPayload, bucketName, next)
  }

  function close() {
    onOpenChange?.(false)
  }

  function handleConfirm() {
    const key = selectedKey.trim()
    if (!connectionId || !bucketName || !key) {
      ElMessage.warning(
        allowCustomKey ? '请选择连接、桶并填写对象 key' : '请选择对象存储中的资源',
      )
      return
    }
    const url = (selectedUrl || buildPublicUrl(key) || '').trim()
    if (!url) {
      ElMessage.warning('无法生成外链，请检查连接 Endpoint')
      return
    }
    onConfirm?.({
      connectionId,
      bucketName,
      objectKey: key,
      url,
    })
    close()
  }

  useEffect(() => {
    if (!open) return
    hydrating.current = true
    skipConnWatch.current = true
    skipBucketWatch.current = true
    void (async () => {
      try {
        const list = await loadLibrary()
        const init = initial
        const nextConnId = init?.connectionId || list[0]?.id || ''
        setConnectionId(nextConnId)
        let nextBucket = init?.bucketName || ''
        setPrefix('')
        setKeyQuery(init?.objectKey || '')
        let nextKey =
          init?.objectKey || (allowCustomKey ? suggestedKey || '' : '') || ''
        setSelectedKey(nextKey)
        const conn = list.find((c) => c.id === nextConnId) ?? null
        const payload = conn
          ? {
              endpoint: conn.endpoint,
              region: conn.region,
              accessKeyId: conn.accessKeyId,
              secretAccessKey: conn.secretAccessKey,
              forcePathStyle: conn.forcePathStyle,
            }
          : null
        let nextBuckets = conn?.buckets ?? []
        if (nextConnId && !nextBuckets.length) {
          nextBuckets = await refreshBuckets(payload, nextConnId)
        }
        if (!nextBucket && nextBuckets[0]) {
          nextBucket = nextBuckets[0].name
        }
        setBucketName(nextBucket)
        setSelectedUrl(
          init?.url ||
            (nextKey && payload && nextBucket
              ? buildPublicUrlFor(payload, nextBucket, nextKey) || ''
              : ''),
        )
        setEntries([])
        if (nextBucket) await loadObjects(payload, nextBucket, '')
        if (allowCustomKey && !init?.objectKey && suggestedKey && !nextKey) {
          nextKey = suggestedKey
          setSelectedKey(suggestedKey)
          setKeyQuery(suggestedKey)
          setSelectedUrl(
            payload && nextBucket
              ? buildPublicUrlFor(payload, nextBucket, suggestedKey) || ''
              : '',
          )
        }
      } finally {
        hydrating.current = false
        queueMicrotask(() => {
          skipConnWatch.current = false
          skipBucketWatch.current = false
        })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || hydrating.current || skipConnWatch.current) return
    setBucketName('')
    setPrefix('')
    setKeyQuery('')
    const nextKey = allowCustomKey ? suggestedKey || '' : ''
    setSelectedKey(nextKey)
    setSelectedUrl('')
    setEntries([])
    const conn = connections.find((c) => c.id === connectionId) ?? null
    const payload = conn
      ? {
          endpoint: conn.endpoint,
          region: conn.region,
          accessKeyId: conn.accessKeyId,
          secretAccessKey: conn.secretAccessKey,
          forcePathStyle: conn.forcePathStyle,
        }
      : null
    void (async () => {
      const nextBuckets = await refreshBuckets(payload, connectionId)
      if (nextBuckets[0]) {
        skipBucketWatch.current = true
        setBucketName(nextBuckets[0].name)
        await loadObjects(payload, nextBuckets[0].name, '')
        queueMicrotask(() => {
          skipBucketWatch.current = false
        })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])

  useEffect(() => {
    if (!open || hydrating.current || skipBucketWatch.current || !bucketName) return
    setPrefix('')
    setKeyQuery(allowCustomKey ? selectedKey : '')
    if (!allowCustomKey) {
      setSelectedKey('')
      setSelectedUrl('')
    } else if (!selectedKey.trim() && suggestedKey) {
      setSelectedKey(suggestedKey)
      setKeyQuery(suggestedKey)
      setSelectedUrl(buildPublicUrl(suggestedKey) || '')
    } else if (selectedKey.trim()) {
      setSelectedUrl(buildPublicUrl(selectedKey.trim()) || '')
    }
    void loadObjects(connectionPayload, bucketName, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketName])

  function buildPublicUrlFor(
    payload: OssConnectionPayload,
    bucket: string,
    key: string,
  ): string | null {
    const endpoint = payload.endpoint.trim().replace(/\/+$/, '')
    const encodedKey = key
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')
    try {
      if (payload.forcePathStyle !== false) {
        return `${endpoint}/${bucket}/${encodedKey}`
      }
      const url = new URL(endpoint)
      return `${url.protocol}//${bucket}.${url.host}/${encodedKey}`
    } catch {
      return `${endpoint}/${bucket}/${encodedKey}`
    }
  }

  return (
    <Modal
      open={open}
      title={dialogTitle}
      width={760}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      className="oss-picker-dialog"
      onCancel={close}
      footer={
        <Button type="primary" disabled={!canConfirm} onClick={handleConfirm}>
          确定
        </Button>
      }
    >
      <Spin spinning={loading}>
        <div className="oss-picker">
          {!projectPath ? (
            <Empty description="未打开项目，无法读取对象存储" styles={{ image: { height: 56 } }} />
          ) : !connections.length ? (
            <Empty
              description="暂无对象存储连接，请先在「对象存储」中配置"
              styles={{ image: { height: 56 } }}
            />
          ) : (
            <>
              <div className="toolbar">
                <Select
                  showSearch
                  placeholder="连接"
                  className="toolbar-conn"
                  value={connectionId || undefined}
                  options={connections.map((c) => ({ label: c.name, value: c.id }))}
                  onChange={setConnectionId}
                />
                <Select
                  showSearch
                  placeholder="桶"
                  className="toolbar-bucket"
                  disabled={!connectionId}
                  value={bucketName || undefined}
                  options={buckets.map((b) => ({ label: b.name, value: b.name }))}
                  onChange={setBucketName}
                />
                <Input
                  className="toolbar-key"
                  value={keyQuery}
                  allowClear
                  placeholder="输入 key"
                  disabled={!bucketName}
                  onChange={(e) => setKeyQuery(e.target.value)}
                  onPressEnter={runSearch}
                />
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  disabled={!bucketName}
                  loading={listing}
                  className="toolbar-search"
                  onClick={runSearch}
                />
              </div>

              {bucketName ? (
                <Spin spinning={listing}>
                  <div className="list-pane">
                    {breadcrumb.length > 1 ? (
                      <div className="crumb">
                        {breadcrumb.map((item, i) => (
                          <button
                            key={item.prefix + i}
                            type="button"
                            className="crumb-btn"
                            onClick={() => goPrefix(item.prefix)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="list-head">
                      <span className="col-name">资源名称</span>
                      <span className="col-action">选择</span>
                    </div>
                    <div className="list-body">
                      {!entries.length ? (
                        <Empty description="空目录" styles={{ image: { height: 48 } }} />
                      ) : (
                        entries.map((row) => (
                          <button
                            key={row.key}
                            type="button"
                            className={`list-row${!row.isPrefix && selectedKey === row.key ? ' selected' : ''}${row.isPrefix ? ' prefix' : ''}`}
                            onClick={() => void selectObject(row)}
                          >
                            <span className="col-name">
                              <span className="thumb-slot">
                                {row.isPrefix ? (
                                  <FolderOutlined className="file-icon folder" />
                                ) : showImageThumb(row) ? (
                                  <img
                                    className="thumb-img"
                                    src={thumbSrc(row.key)}
                                    alt=""
                                    onError={() => onThumbError(row.key)}
                                  />
                                ) : (
                                  <FileOutlined className="file-icon" />
                                )}
                              </span>
                              <span className="name-text">{displayName(row)}</span>
                              {!row.isPrefix ? (
                                <span className="size-hint">{row.size}</span>
                              ) : null}
                            </span>
                            <span className="col-action">
                              {row.isPrefix ? (
                                <span className="enter-hint">进入</span>
                              ) : selectedKey === row.key ? (
                                <span className="picked-hint">已选</span>
                              ) : (
                                <span className="pick-hint">选择</span>
                              )}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </Spin>
              ) : (
                <div className="list-pane list-pane--empty">
                  <Empty description="请先选择连接与桶" styles={{ image: { height: 48 } }} />
                </div>
              )}

              {selectedKey ? (
                <div className="selected-bar">
                  <span className="selected-label">已选</span>
                  <span className="selected-key" title={selectedKey}>
                    {selectedKey}
                  </span>
                  {metaLoading ? (
                    <span className="selected-url">解析外链中…</span>
                  ) : selectedUrl ? (
                    <span className="selected-url" title={selectedUrl}>
                      {selectedUrl}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </Spin>
    </Modal>
  )
}
