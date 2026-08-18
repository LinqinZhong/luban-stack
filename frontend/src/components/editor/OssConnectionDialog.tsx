import { useEffect, useState } from 'react'
import { Button, Input, Modal, Switch } from 'antd'
import { ElMessage } from '../../ui/feedback'
import { testOssConnection } from '../../api/projects'
import type { OssBucketInfo, OssConnectionConfig } from '../../types/oss'
import './OssConnectionDialog.css'

const emptyForm = {
  id: '',
  name: '',
  endpoint: '',
  region: 'us-east-1',
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: true,
}

export default function OssConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  connection: OssConnectionConfig | null
  onSave?: (conn: OssConnectionConfig) => void
}) {
  const [testing, setTesting] = useState(false)
  const [testedOk, setTestedOk] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [fetchedBuckets, setFetchedBuckets] = useState<OssBucketInfo[]>([])
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    if (!open) return
    const src = connection
    setTestedOk(false)
    setShowErrors(false)
    setFetchedBuckets(src?.buckets ?? [])
    setForm({
      id: src?.id ?? '',
      name: src?.name ?? '',
      endpoint: src?.endpoint ?? '',
      region: src?.region || 'us-east-1',
      accessKeyId: src?.accessKeyId ?? '',
      secretAccessKey: src?.secretAccessKey ?? '',
      forcePathStyle: src?.forcePathStyle !== false,
    })
  }, [open, connection])

  function markDirty() {
    setTestedOk(false)
  }

  function patchForm(partial: Partial<typeof emptyForm>) {
    markDirty()
    setForm((prev) => ({ ...prev, ...partial }))
  }

  const nameError = showErrors && !form.name.trim()
  const endpointError = showErrors && !form.endpoint.trim()
  const accessKeyError = showErrors && !form.accessKeyId.trim()
  const secretError = showErrors && !form.secretAccessKey.trim()

  function buildPayload() {
    return {
      endpoint: form.endpoint.trim(),
      region: form.region.trim() || 'us-east-1',
      accessKeyId: form.accessKeyId.trim(),
      secretAccessKey: form.secretAccessKey,
      forcePathStyle: form.forcePathStyle,
    }
  }

  function validateForm(): boolean {
    setShowErrors(true)
    return Boolean(
      form.name.trim() &&
        form.endpoint.trim() &&
        form.accessKeyId.trim() &&
        form.secretAccessKey.trim(),
    )
  }

  async function handleTest() {
    if (!validateForm()) {
      ElMessage.error('请完善必填项')
      return
    }
    setTesting(true)
    setTestedOk(false)
    try {
      const result = await testOssConnection(buildPayload())
      setFetchedBuckets(result.buckets)
      setTestedOk(true)
      ElMessage.success(`连接成功，共 ${result.buckets.length} 个桶`)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '测试连接失败')
    } finally {
      setTesting(false)
    }
  }

  function close() {
    onOpenChange?.(false)
  }

  function handleSave() {
    if (!validateForm()) {
      ElMessage.error('请完善必填项')
      return
    }
    if (!testedOk) {
      ElMessage.warning('请先测试连接成功后再保存')
      return
    }
    const payload = buildPayload()
    const next: OssConnectionConfig = {
      id: form.id || `oss_${Date.now().toString(36)}`,
      name: form.name.trim(),
      endpoint: payload.endpoint,
      region: payload.region,
      accessKeyId: payload.accessKeyId,
      secretAccessKey: payload.secretAccessKey,
      forcePathStyle: payload.forcePathStyle,
      buckets: fetchedBuckets,
      lastTestedAt: Date.now(),
    }
    onSave?.(next)
    close()
  }

  return (
    <Modal
      open={open}
      title={connection ? `配置对象存储 · ${connection.name}` : '添加对象存储连接'}
      width={720}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={close}
      footer={
        <>
          <Button loading={testing} onClick={() => void handleTest()}>
            测试连接
          </Button>
          <Button type="primary" disabled={!testedOk} onClick={handleSave}>
            保存
          </Button>
        </>
      }
    >
      <div className="oss-form">
        <div className="form-item">
          <div className="label">显示名称</div>
          <div className="content">
            <Input
              value={form.name}
              placeholder="如 测试环境"
              status={nameError ? 'error' : undefined}
              onChange={(e) => patchForm({ name: e.target.value })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">Endpoint</div>
          <div className="content">
            <Input
              value={form.endpoint}
              placeholder="http://127.0.0.1:9000 或 https://oss-cn-hangzhou.aliyuncs.com"
              status={endpointError ? 'error' : undefined}
              onChange={(e) => patchForm({ endpoint: e.target.value })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">Region</div>
          <div className="content">
            <Input
              value={form.region}
              placeholder="us-east-1 / oss-cn-hangzhou"
              onChange={(e) => patchForm({ region: e.target.value })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">AccessKeyId</div>
          <div className="content">
            <Input
              value={form.accessKeyId}
              placeholder="Access Key"
              status={accessKeyError ? 'error' : undefined}
              onChange={(e) => patchForm({ accessKeyId: e.target.value })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">SecretKey</div>
          <div className="content">
            <Input.Password
              value={form.secretAccessKey}
              placeholder="Secret Access Key"
              status={secretError ? 'error' : undefined}
              onChange={(e) => patchForm({ secretAccessKey: e.target.value })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">Path Style</div>
          <div className="content path-style">
            <Switch
              checked={form.forcePathStyle}
              onChange={(checked) => patchForm({ forcePathStyle: checked })}
            />
            <span className="hint">MinIO 等本地服务通常需要开启</span>
          </div>
        </div>

        {testedOk ? (
          <div className="test-ok">已通过测试 · {fetchedBuckets.length} 个桶</div>
        ) : null}
      </div>
    </Modal>
  )
}
