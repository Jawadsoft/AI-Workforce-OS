// This project uses sonner for toasts (already configured in app/layout.tsx).
// This file exists only to satisfy type imports from use-toast.ts.

export type ToastProps = {
  variant?: 'default' | 'destructive'
}

export type ToastActionElement = React.ReactElement
