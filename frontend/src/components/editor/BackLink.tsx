import type { MouseEvent } from 'react'
import { Button } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import './BackLink.css'

export default function BackLink({
  label = '返回',
  disabled = false,
  onClick,
}: {
  label?: string
  disabled?: boolean
  onClick?: (event: MouseEvent<HTMLElement>) => void
}) {
  return (
    <Button
      className="back-link"
      type="link"
      icon={<ArrowLeftOutlined />}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  )
}
