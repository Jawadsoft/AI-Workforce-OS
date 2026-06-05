'use client'

// Re-export from sonner so all components can use the same useToast pattern
import { toast as sonnerToast } from 'sonner'

interface ToastOptions {
  title?: string
  description?: string
  variant?: 'default' | 'destructive'
}

function toast(opts: ToastOptions) {
  const message = opts.title ?? ''
  const description = opts.description
  if (opts.variant === 'destructive') {
    sonnerToast.error(message, { description })
  } else {
    sonnerToast.success(message, { description })
  }
}

function useToast() {
  return { toast }
}

export { useToast, toast }
