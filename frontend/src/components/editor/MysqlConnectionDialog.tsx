import { useEffect, useState } from 'react'
import { Button, Input, InputNumber, Modal, Radio, Switch } from 'antd'
import { ElMessage } from '../../ui/feedback'
import { testMysqlConnection } from '../../api/projects'
import {
  createEmptySshConfig,
  type MysqlDatabaseConfig,
  type MysqlSshAuthType,
  type MysqlTableInfo,
} from '../../types/mysql'
import './MysqlConnectionDialog.css'

type FormState = {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  database: string
  sshEnabled: boolean
  sshHost: string
  sshPort: number
  sshUsername: string
  sshAuthType: MysqlSshAuthType
  sshPassword: string
  sshPrivateKey: string
  sshPassphrase: string
}

const defaultForm: FormState = {
  id: '',
  name: '',
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  password: '',
  database: '',
  sshEnabled: false,
  sshHost: '',
  sshPort: 22,
  sshUsername: '',
  sshAuthType: 'password',
  sshPassword: '',
  sshPrivateKey: '',
  sshPassphrase: '',
}

export default function MysqlConnectionDialog({
  open,
  onOpenChange,
  database,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  database: MysqlDatabaseConfig | null
  onSave?: (db: MysqlDatabaseConfig) => void
}) {
  const [testing, setTesting] = useState(false)
  const [testedOk, setTestedOk] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [fetchedTables, setFetchedTables] = useState<MysqlTableInfo[]>([])
  const [serverVersion, setServerVersion] = useState('')
  const [form, setForm] = useState<FormState>(defaultForm)

  useEffect(() => {
    if (!open) return
    const src = database
    setTestedOk(false)
    setShowErrors(false)
    setFetchedTables(src?.tables ?? [])
    setServerVersion('')
    const ssh = src?.ssh ?? createEmptySshConfig()
    setForm({
      id: src?.id ?? '',
      name: src?.name ?? '',
      host: src?.host ?? '127.0.0.1',
      port: src?.port ?? 3306,
      username: src?.username ?? 'root',
      password: src?.password ?? '',
      database: src?.database ?? '',
      sshEnabled: ssh.enabled,
      sshHost: ssh.host,
      sshPort: ssh.port || 22,
      sshUsername: ssh.username,
      sshAuthType: ssh.authType,
      sshPassword: ssh.password,
      sshPrivateKey: ssh.privateKey,
      sshPassphrase: ssh.passphrase,
    })
  }, [open, database])

  function markDirty() {
    setTestedOk(false)
  }

  function patchForm(partial: Partial<FormState>) {
    markDirty()
    setForm((prev) => ({ ...prev, ...partial }))
  }

  const nameError = showErrors && !form.name.trim()
  const hostError = showErrors && !form.host.trim()
  const userError = showErrors && !form.username.trim()
  const sshHostError = showErrors && form.sshEnabled && !form.sshHost.trim()
  const sshUserError = showErrors && form.sshEnabled && !form.sshUsername.trim()

  function buildPayload() {
    return {
      host: form.host.trim(),
      port: Number(form.port) || 3306,
      username: form.username.trim(),
      password: form.password,
      database: form.database.trim(),
      ssh: {
        enabled: form.sshEnabled,
        host: form.sshHost.trim(),
        port: Number(form.sshPort) || 22,
        username: form.sshUsername.trim(),
        authType: form.sshAuthType,
        password: form.sshPassword,
        privateKey: form.sshPrivateKey,
        passphrase: form.sshPassphrase,
      },
    }
  }

  function validateForm(): boolean {
    setShowErrors(true)
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) return false
    if (form.sshEnabled) {
      if (!form.sshHost.trim() || !form.sshUsername.trim()) return false
      if (form.sshAuthType === 'password' && !form.sshPassword) {
        ElMessage.error('请填写 SSH 密码')
        return false
      }
      if (form.sshAuthType === 'privateKey' && !form.sshPrivateKey.trim()) {
        ElMessage.error('请填写 SSH 私钥')
        return false
      }
    }
    return true
  }

  async function handleTest() {
    if (!validateForm()) {
      ElMessage.error('请完善必填项')
      return
    }
    setTesting(true)
    setTestedOk(false)
    try {
      const result = await testMysqlConnection(buildPayload())
      setFetchedTables(result.tables)
      setServerVersion(result.serverVersion)
      setTestedOk(true)
      ElMessage.success(
        `连接成功${result.serverVersion ? `（${result.serverVersion}）` : ''}，共 ${result.tables.length} 张表`,
      )
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
    const next: MysqlDatabaseConfig = {
      id: form.id || `mysql_${Date.now().toString(36)}`,
      name: form.name.trim(),
      host: payload.host,
      port: payload.port,
      username: payload.username,
      password: payload.password,
      database: payload.database,
      ssh: payload.ssh,
      tables: fetchedTables,
      lastTestedAt: Date.now(),
    }
    onSave?.(next)
    close()
  }

  return (
    <Modal
      open={open}
      title={database ? `配置 MySQL · ${database.name}` : '添加 MySQL 数据库'}
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
      <div className="mysql-form">
        <div className="form-item">
          <div className="label">显示名称</div>
          <div className="content">
            <Input
              value={form.name}
              placeholder="如 goods"
              status={nameError ? 'error' : undefined}
              onChange={(e) => patchForm({ name: e.target.value })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">主机</div>
          <div className="content">
            <Input
              value={form.host}
              placeholder="127.0.0.1"
              status={hostError ? 'error' : undefined}
              onChange={(e) => patchForm({ host: e.target.value })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">端口</div>
          <div className="content">
            <InputNumber
              value={form.port}
              min={1}
              max={65535}
              controls
              onChange={(value) => patchForm({ port: Number(value) || 3306 })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">用户名</div>
          <div className="content">
            <Input
              value={form.username}
              placeholder="root"
              status={userError ? 'error' : undefined}
              onChange={(e) => patchForm({ username: e.target.value })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">密码</div>
          <div className="content">
            <Input.Password
              value={form.password}
              placeholder="密码"
              onChange={(e) => patchForm({ password: e.target.value })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">数据库</div>
          <div className="content">
            <Input
              value={form.database}
              placeholder="可选，连接后默认库"
              onChange={(e) => patchForm({ database: e.target.value })}
            />
          </div>
        </div>

        <div className="form-item">
          <div className="label">SSH 隧道</div>
          <div className="content">
            <Switch
              checked={form.sshEnabled}
              onChange={(checked) => patchForm({ sshEnabled: checked })}
            />
          </div>
        </div>

        {form.sshEnabled ? (
          <>
            <div className="form-item">
              <div className="label">SSH 主机</div>
              <div className="content">
                <Input
                  value={form.sshHost}
                  placeholder="跳板机地址"
                  status={sshHostError ? 'error' : undefined}
                  onChange={(e) => patchForm({ sshHost: e.target.value })}
                />
              </div>
            </div>
            <div className="form-item">
              <div className="label">SSH 端口</div>
              <div className="content">
                <InputNumber
                  value={form.sshPort}
                  min={1}
                  max={65535}
                  controls
                  onChange={(value) => patchForm({ sshPort: Number(value) || 22 })}
                />
              </div>
            </div>
            <div className="form-item">
              <div className="label">SSH 用户</div>
              <div className="content">
                <Input
                  value={form.sshUsername}
                  status={sshUserError ? 'error' : undefined}
                  onChange={(e) => patchForm({ sshUsername: e.target.value })}
                />
              </div>
            </div>
            <div className="form-item">
              <div className="label">认证方式</div>
              <div className="content">
                <Radio.Group
                  optionType="button"
                  value={form.sshAuthType}
                  onChange={(e) => patchForm({ sshAuthType: e.target.value })}
                >
                  <Radio.Button value="password">密码</Radio.Button>
                  <Radio.Button value="privateKey">私钥</Radio.Button>
                </Radio.Group>
              </div>
            </div>
            {form.sshAuthType === 'password' ? (
              <div className="form-item">
                <div className="label">SSH 密码</div>
                <div className="content">
                  <Input.Password
                    value={form.sshPassword}
                    onChange={(e) => patchForm({ sshPassword: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="form-item">
                  <div className="label">私钥</div>
                  <div className="content">
                    <Input.TextArea
                      value={form.sshPrivateKey}
                      rows={4}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      onChange={(e) => patchForm({ sshPrivateKey: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-item">
                  <div className="label">私钥口令</div>
                  <div className="content">
                    <Input.Password
                      value={form.sshPassphrase}
                      placeholder="可选"
                      onChange={(e) => patchForm({ sshPassphrase: e.target.value })}
                    />
                  </div>
                </div>
              </>
            )}
          </>
        ) : null}

        {testedOk ? (
          <div className="test-ok">
            已通过测试
            {serverVersion ? ` · ${serverVersion}` : ''}
            {` · ${fetchedTables.length} 张表`}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
