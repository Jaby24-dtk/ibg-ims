'use client'

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'gray' | 'purple'
  children: React.ReactNode
  className?: string
}

export default function Badge({ variant = 'gray', children, className }: BadgeProps) {
  return (
    <span className={`badge badge-${variant} ${className ?? ''}`}>
      {children}
    </span>
  )
}
