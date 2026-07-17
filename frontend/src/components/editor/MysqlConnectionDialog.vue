<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { testMysqlConnection } from '../../api/projects'
import {
  createEmptySshConfig,
  type MysqlDatabaseConfig,
  type MysqlSshAuthType,
  type MysqlTableInfo,
} from '../../types/mysql'

const props = defineProps<{
  modelValue: boolean
  database: MysqlDatabaseConfig | null
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [db: MysqlDatabaseConfig]
}>()

const testing = ref(false)
const testedOk = ref(false)
const showErrors = ref(false)
const fetchedTables = ref<MysqlTableInfo[]>([])
const serverVersion = ref('')

const form = reactive({
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
  sshAuthType: 'password' as MysqlSshAuthType,
  sshPassword: '',
  sshPrivateKey: '',
  sshPassphrase: '',
})

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    const src = props.database
    testedOk.value = false
    showErrors.value = false
    fetchedTables.value = src?.tables ?? []
    serverVersion.value = ''
    form.id = src?.id ?? ''
    form.name = src?.name ?? ''
    form.host = src?.host ?? '127.0.0.1'
    form.port = src?.port ?? 3306
    form.username = src?.username ?? 'root'
    form.password = src?.password ?? ''
    form.database = src?.database ?? ''
    const ssh = src?.ssh ?? createEmptySshConfig()
    form.sshEnabled = ssh.enabled
    form.sshHost = ssh.host
    form.sshPort = ssh.port || 22
    form.sshUsername = ssh.username
    form.sshAuthType = ssh.authType
    form.sshPassword = ssh.password
    form.sshPrivateKey = ssh.privateKey
    form.sshPassphrase = ssh.passphrase
  },
)

function markDirty() {
  testedOk.value = false
}

const nameError = computed(() => {
  if (!showErrors.value) return false
  return !form.name.trim()
})

const hostError = computed(() => {
  if (!showErrors.value) return false
  return !form.host.trim()
})

const userError = computed(() => {
  if (!showErrors.value) return false
  return !form.username.trim()
})

const sshHostError = computed(() => {
  if (!showErrors.value || !form.sshEnabled) return false
  return !form.sshHost.trim()
})

const sshUserError = computed(() => {
  if (!showErrors.value || !form.sshEnabled) return false
  return !form.sshUsername.trim()
})

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
  showErrors.value = true
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
  testing.value = true
  testedOk.value = false
  try {
    const result = await testMysqlConnection(buildPayload())
    fetchedTables.value = result.tables
    serverVersion.value = result.serverVersion
    testedOk.value = true
    ElMessage.success(
      `连接成功${result.serverVersion ? `（${result.serverVersion}）` : ''}，共 ${result.tables.length} 张表`,
    )
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '测试连接失败')
  } finally {
    testing.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}

function handleSave() {
  if (!validateForm()) {
    ElMessage.error('请完善必填项')
    return
  }
  if (!testedOk.value) {
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
    tables: fetchedTables.value,
    lastTestedAt: Date.now(),
  }
  emit('save', next)
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="database ? `配置 MySQL · ${database.name}` : '添加 MySQL 数据库'"
    width="720px"
    destroy-on-close
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="mysql-form">
      <div class="form-item">
        <div class="label">显示名称</div>
        <div class="content">
          <el-input
            v-model="form.name"
            placeholder="如 goods"
            :status="nameError ? 'error' : undefined"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">主机</div>
        <div class="content">
          <el-input
            v-model="form.host"
            placeholder="127.0.0.1"
            :status="hostError ? 'error' : undefined"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">端口</div>
        <div class="content">
          <el-input-number
            v-model="form.port"
            :min="1"
            :max="65535"
            controls-position="right"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">用户名</div>
        <div class="content">
          <el-input
            v-model="form.username"
            placeholder="root"
            :status="userError ? 'error' : undefined"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">密码</div>
        <div class="content">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="密码"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">数据库</div>
        <div class="content">
          <el-input
            v-model="form.database"
            placeholder="可选，连接后默认库"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">SSH 隧道</div>
        <div class="content">
          <el-switch v-model="form.sshEnabled" @change="markDirty" />
        </div>
      </div>

      <template v-if="form.sshEnabled">
        <div class="form-item">
          <div class="label">SSH 主机</div>
          <div class="content">
            <el-input
              v-model="form.sshHost"
              placeholder="跳板机地址"
              :status="sshHostError ? 'error' : undefined"
              @update:model-value="markDirty"
            />
          </div>
        </div>
        <div class="form-item">
          <div class="label">SSH 端口</div>
          <div class="content">
            <el-input-number
              v-model="form.sshPort"
              :min="1"
              :max="65535"
              controls-position="right"
              @update:model-value="markDirty"
            />
          </div>
        </div>
        <div class="form-item">
          <div class="label">SSH 用户</div>
          <div class="content">
            <el-input
              v-model="form.sshUsername"
              :status="sshUserError ? 'error' : undefined"
              @update:model-value="markDirty"
            />
          </div>
        </div>
        <div class="form-item">
          <div class="label">认证方式</div>
          <div class="content">
            <el-radio-group v-model="form.sshAuthType" @change="markDirty">
              <el-radio-button value="password">密码</el-radio-button>
              <el-radio-button value="privateKey">私钥</el-radio-button>
            </el-radio-group>
          </div>
        </div>
        <div v-if="form.sshAuthType === 'password'" class="form-item">
          <div class="label">SSH 密码</div>
          <div class="content">
            <el-input
              v-model="form.sshPassword"
              type="password"
              show-password
              @update:model-value="markDirty"
            />
          </div>
        </div>
        <template v-else>
          <div class="form-item">
            <div class="label">私钥</div>
            <div class="content">
              <el-input
                v-model="form.sshPrivateKey"
                type="textarea"
                :rows="4"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                @update:model-value="markDirty"
              />
            </div>
          </div>
          <div class="form-item">
            <div class="label">私钥口令</div>
            <div class="content">
              <el-input
                v-model="form.sshPassphrase"
                type="password"
                show-password
                placeholder="可选"
                @update:model-value="markDirty"
              />
            </div>
          </div>
        </template>
      </template>

      <div v-if="testedOk" class="test-ok">
        已通过测试
        <span v-if="serverVersion">· {{ serverVersion }}</span>
        · {{ fetchedTables.length }} 张表
      </div>
    </div>

    <template #footer>
      <el-button :loading="testing" @click="handleTest">测试连接</el-button>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!testedOk" @click="handleSave">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mysql-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-item {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.label {
  width: 96px;
  flex-shrink: 0;
  padding-top: 6px;
  font-size: 13px;
  line-height: 20px;
  color: #606266;
  text-align: right;
}

.content {
  flex: 1;
  min-width: 0;
}

.test-ok {
  margin-left: 112px;
  font-size: 12px;
  color: #67c23a;
  line-height: 1.4;
}
</style>
