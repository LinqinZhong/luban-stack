<template>
  <el-card shadow="never">
    <template #header>关于项目</template>

    <el-space direction="vertical" alignment="start" :size="16">
      <p>Voider 是一个前后端分离的本地系统项目。</p>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="前端">
          Vue 3 + TypeScript + Element Plus + Vite
        </el-descriptions-item>
        <el-descriptions-item label="后端">
          Node.js + Express + TypeScript
        </el-descriptions-item>
        <el-descriptions-item label="前端端口">
          5173
        </el-descriptions-item>
        <el-descriptions-item label="后端端口">
          3000
        </el-descriptions-item>
      </el-descriptions>
    </el-space>
  </el-card>
</template>
