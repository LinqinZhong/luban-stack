# 测试

Exported from Voider as a Vue 3 + Vite + TypeScript + Tailwind CSS + Pinia + Vue Router project.

## Setup

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (default http://localhost:5173).

## Project structure

- `src/views/` — page views (data pool as ref/computed in the page)
- `src/components/` — reusable components
- `src/stores/` — Pinia stores for component data pools
- `src/runtime/helpers.ts` — navigateTo / navigateBack / showToast / getDeviceInfo
- `src/runtime/voider.ts` — visibility & interpolate helpers
