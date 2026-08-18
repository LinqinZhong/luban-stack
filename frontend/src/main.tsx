import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { colorPrimary } from './theme'
import 'antd/dist/reset.css'
import './style.css'

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary,
          borderRadius: 4,
          controlHeight: 28,
          fontSize: 13,
          fontSizeSM: 12,
          sizeStep: 4,
          sizeUnit: 4,
          fontFamily:
            "'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif",
        },
        components: {
          Form: {
            itemMarginBottom: 12,
            verticalLabelPadding: '0 0 6px',
          },
          Button: {
            paddingInline: 10,
          },
        },
      }}
      componentSize="small"
    >
      <App />
    </ConfigProvider>
  </StrictMode>,
)
