import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Input, Modal, Spin, Table } from 'antd'
import {
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import {
  deleteOssObject,
  getOssObjectMeta,
  listOssObjects,
  signOssObject,
  uploadOssObject,
} from '../../api/projects'
import type {
  OssBucketInfo,
  OssConnectionPayload,
  OssObjectInfo,
} from '../../types/oss'
import BackLink from './BackLink'
import './OssObjectsPanel.css'

type ObjectMeta = {
  key: string
  size: number
  contentType: string
  lastModified: string | null
  etag: string
  publicUrl: string
  signedUrl: string
  isImage: boolean
}

export default function OssObjectsPanel({
  connection,
  bucket,
  onBack,
}: {
  connection: OssConnectionPayload | null
  bucket: OssBucketInfo
  onBack?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [prefix, setPrefix] = useState('')
  const [entries, setEntries] = useState<OssObjectInfo[]>([])
  const [isTruncated, setIsTruncated] = useState(false)
  const [nextToken, setNextToken] = useState<string | null>(null)
  const [uploadVisible, setUploadVisible] = useState(false)
  const [uploadKey, setUploadKey] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [metaVisible, setMetaVisible] = useState(false)
  const [metaLoading, setMetaLoading] = useState(false)
  const [objectMeta, setObjectMeta] = useState<ObjectMeta | null>(null)
  const [previewBroken, setPreviewBroken] = useState(false)
  const [signedThumbMap, setSignedThumbMap] = useState<Record<string, string>>({})

  const isPrivateBucket = bucket.access !== 'public'

  const breadcrumb = useMemo(() => {
    const parts = prefix.split('/').filter(Boolean)
    const items: { label: string; prefix: string }[] = [
      { label: bucket.name, prefix: '' },
    ]
    let acc = ''
    for (const part of parts) {
      acc += `${part}/`
      items.push({ label: part, prefix: acc })
    }
    return items
  }, [prefix, bucket.name])

  function formatSize(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  function formatTime(iso: string | null): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

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

  function buildPublicUrl(key: string): string | null {
    if (!connection?.endpoint) return null
    const endpoint = connection.endpoint.trim().replace(/\/+$/, '')
    const encodedKey = key
      .replace(/^\/+/, '')
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')
    try {
      if (connection.forcePathStyle !== false) {
        return `${endpoint}/${bucket.name}/${encodedKey}`
      }
      const url = new URL(endpoint)
      return `${url.protocol}//${bucket.name}.${url.host}/${encodedKey}`
    } catch {
      return null
    }
  }

  async function copyText(text: string, successMsg = '已复制外链') {
    try {
      await navigator.clipboard.writeText(text)
      ElMessage.success(successMsg)
    } catch {
      ElMessage.error('复制失败，请手动复制')
    }
  }

  async function copyObjectLink(row: OssObjectInfo) {
    if (row.isPrefix || !connection) return
    if (isPrivateBucket) {
      try {
        const result = await signOssObject({
          ...connection,
          bucketName: bucket.name,
          key: row.key,
        })
        await copyText(result.signedUrl, '已复制临时签名链接（约 1 小时有效）')
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '签名失败')
      }
      return
    }
    const url = buildPublicUrl(row.key)
    if (!url) {
      ElMessage.warning('无法生成外链，请检查 Endpoint 配置')
      return
    }
    await copyText(url)
  }

  function thumbSrc(key: string): string | undefined {
    if (isPrivateBucket) return signedThumbMap[key]
    return buildPublicUrl(key) || undefined
  }

  async function refreshSignedThumbs(rows: OssObjectInfo[]) {
    if (!connection || !isPrivateBucket) {
      setSignedThumbMap({})
      return
    }
    const images = rows.filter((r) => !r.isPrefix && isImageKey(r.key))
    const next: Record<string, string> = {}
    await Promise.all(
      images.map(async (row) => {
        try {
          const result = await signOssObject({
            ...connection,
            bucketName: bucket.name,
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

  async function loadObjects(append = false, nextPrefix = prefix, token = nextToken) {
    if (!connection) return
    setLoading(true)
    try {
      const result = await listOssObjects({
        ...connection,
        bucketName: bucket.name,
        prefix: nextPrefix,
        continuationToken: append ? token || undefined : undefined,
      })
      const next = [...result.prefixes, ...result.objects]
      const merged = append ? [...entries, ...next] : next
      setEntries(merged)
      setIsTruncated(result.isTruncated)
      setNextToken(result.nextContinuationToken)
      if (!append) setSignedThumbMap({})
      void refreshSignedThumbs(merged)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '加载对象失败')
    } finally {
      setLoading(false)
    }
  }

  function goPrefix(nextPrefix: string) {
    setPrefix(nextPrefix)
    setNextToken(null)
    void loadObjects(false, nextPrefix, null)
  }

  function openEntry(row: OssObjectInfo) {
    if (row.isPrefix) {
      goPrefix(row.key)
      return
    }
    void viewMeta(row)
  }

  async function viewMeta(row: OssObjectInfo) {
    if (!connection || row.isPrefix) return
    setMetaVisible(true)
    setMetaLoading(true)
    setObjectMeta(null)
    setPreviewBroken(false)
    try {
      setObjectMeta(
        await getOssObjectMeta({
          ...connection,
          bucketName: bucket.name,
          key: row.key,
        }),
      )
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '获取对象信息失败')
      setMetaVisible(false)
    } finally {
      setMetaLoading(false)
    }
  }

  function openUpload() {
    setUploadKey(prefix)
    setUploadFile(null)
    setUploadVisible(true)
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setUploadFile(file)
    if (file && (!uploadKey || uploadKey.endsWith('/'))) {
      setUploadKey(`${prefix}${file.name}`)
    }
    event.target.value = ''
  }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = String(reader.result ?? '')
        const idx = result.indexOf(',')
        resolve(idx >= 0 ? result.slice(idx + 1) : result)
      }
      reader.onerror = () => reject(new Error('读取文件失败'))
      reader.readAsDataURL(file)
    })
  }

  async function handleUpload() {
    if (!connection) return
    const key = uploadKey.trim().replace(/^\/+/, '')
    if (!key || key.endsWith('/')) {
      ElMessage.error('请填写完整的对象 Key（含文件名）')
      return
    }
    if (!uploadFile) {
      ElMessage.error('请选择要上传的文件')
      return
    }
    if (uploadFile.size > 32 * 1024 * 1024) {
      ElMessage.error('单次上传不超过 32MB')
      return
    }
    setUploading(true)
    try {
      const contentBase64 = await readFileAsBase64(uploadFile)
      await uploadOssObject({
        ...connection,
        bucketName: bucket.name,
        key,
        contentBase64,
        contentType: uploadFile.type || 'application/octet-stream',
      })
      ElMessage.success(`已上传 ${key}`)
      setUploadVisible(false)
      await loadObjects(false, prefix, null)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function removeObject(row: OssObjectInfo) {
    if (!connection || row.isPrefix) return
    try {
      await ElMessageBox.confirm(
        `确定删除对象「${row.key}」吗？此操作不可恢复。`,
        '删除对象',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    setLoading(true)
    try {
      await deleteOssObject({
        ...connection,
        bucketName: bucket.name,
        key: row.key,
      })
      ElMessage.success('已删除')
      await loadObjects(false, prefix, null)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPrefix('')
    setEntries([])
    setNextToken(null)
    void loadObjects(false, '', null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket?.name, connection?.endpoint])

  const columns = [
    {
      title: '名称',
      key: 'name',
      minWidth: 240,
      render: (_: unknown, row: OssObjectInfo) => (
        <button type="button" className="name-btn" onClick={() => openEntry(row)}>
          {row.isPrefix ? (
            <FolderOutlined className="folder-icon" />
          ) : isImageKey(row.key) ? (
            <img
              className="thumb"
              src={thumbSrc(row.key)}
              alt=""
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : null}
          {displayName(row)}
        </button>
      ),
    },
    {
      title: '类型',
      key: 'type',
      width: 100,
      render: (_: unknown, row: OssObjectInfo) =>
        row.isPrefix ? '目录' : isImageKey(row.key) ? '图片' : '文件',
    },
    {
      title: '大小',
      key: 'size',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, row: OssObjectInfo) =>
        row.isPrefix ? '—' : formatSize(row.size),
    },
    {
      title: '修改时间',
      key: 'lastModified',
      width: 180,
      render: (_: unknown, row: OssObjectInfo) => formatTime(row.lastModified),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      fixed: 'right' as const,
      render: (_: unknown, row: OssObjectInfo) =>
        !row.isPrefix ? (
          <>
            <Button type="link" onClick={() => void viewMeta(row)}>
              查看
            </Button>
            <Button type="link" onClick={() => void copyObjectLink(row)}>
              复制外链
            </Button>
            <Button type="link" danger onClick={() => void removeObject(row)}>
              删除
            </Button>
          </>
        ) : (
          <Button type="link" onClick={() => openEntry(row)}>
            打开
          </Button>
        ),
    },
  ]

  return (
    <div className="oss-objects">
      <Spin spinning={loading}>
        <div className="pane-head">
          <BackLink onClick={() => onBack?.()} />
          <div className="crumbs">
            {breadcrumb.map((item, index) => (
              <button
                key={item.prefix + index}
                type="button"
                className={`crumb${index === breadcrumb.length - 1 ? ' current' : ''}`}
                onClick={() => goPrefix(item.prefix)}
              >
                {item.label}
                {index < breadcrumb.length - 1 ? <span className="sep">/</span> : null}
              </button>
            ))}
          </div>
          <Button
            type="link"
            icon={<ReloadOutlined />}
            onClick={() => void loadObjects(false, prefix, null)}
          >
            刷新
          </Button>
          <Button type="link" icon={<UploadOutlined />} onClick={openUpload}>
            上传
          </Button>
        </div>

        {!entries.length ? (
          <Empty description="暂无对象，点击上传" styles={{ image: { height: 64 } }} />
        ) : (
          <div className="table-wrap">
            <Table
              dataSource={entries}
              columns={columns}
              bordered
              size="small"
              pagination={false}
              rowKey="key"
              locale={{ emptyText: '无对象' }}
            />
            {isTruncated ? (
              <div className="more-row">
                <Button
                  type="link"
                  icon={<PlusOutlined />}
                  onClick={() => void loadObjects(true)}
                >
                  加载更多
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Spin>

      <Modal
        open={uploadVisible}
        title="上传对象"
        width={560}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setUploadVisible(false)}
        footer={
          <Button type="primary" loading={uploading} onClick={() => void handleUpload()}>
            上传
          </Button>
        }
      >
        <div className="upload-form">
          <div className="form-item">
            <div className="label">对象 Key</div>
            <div className="content">
              <Input
                value={uploadKey}
                placeholder="path/to/file.png"
                onChange={(e) => setUploadKey(e.target.value)}
              />
            </div>
          </div>
          <div className="form-item">
            <div className="label">文件</div>
            <div className="content file-row">
              <Button onClick={() => fileInputRef.current?.click()}>选择文件</Button>
              <span className="file-name">{uploadFile?.name || '未选择'}</span>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden-input"
                onChange={onFileChange}
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={metaVisible}
        title="对象信息"
        width={640}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setMetaVisible(false)}
        footer={null}
      >
        <Spin spinning={metaLoading}>
          <div className="meta-body">
            {objectMeta ? (
              <>
                {objectMeta.isImage ? (
                  <div className="preview-wrap">
                    {!previewBroken ? (
                      <img
                        className="preview-img"
                        src={objectMeta.signedUrl || objectMeta.publicUrl}
                        alt={objectMeta.key}
                        onError={() => setPreviewBroken(true)}
                      />
                    ) : (
                      <div className="preview-fallback">
                        图片无法预览（可能未公开或链接失效）
                      </div>
                    )}
                  </div>
                ) : null}
                <div className="meta-row">
                  <span>Key</span>
                  <code>{objectMeta.key}</code>
                </div>
                <div className="meta-row">
                  <span>大小</span>
                  <code>{formatSize(objectMeta.size)}</code>
                </div>
                <div className="meta-row">
                  <span>类型</span>
                  <code>{objectMeta.contentType}</code>
                </div>
                <div className="meta-row">
                  <span>外链</span>
                  <div className="url-row">
                    <code>{objectMeta.publicUrl}</code>
                    <Button
                      type="link"
                      onClick={() => void copyText(objectMeta.publicUrl)}
                    >
                      复制
                    </Button>
                  </div>
                </div>
                <div className="meta-row">
                  <span>ETag</span>
                  <code>{objectMeta.etag || '—'}</code>
                </div>
                <div className="meta-row">
                  <span>修改时间</span>
                  <code>{formatTime(objectMeta.lastModified)}</code>
                </div>
              </>
            ) : null}
          </div>
        </Spin>
      </Modal>
    </div>
  )
}
