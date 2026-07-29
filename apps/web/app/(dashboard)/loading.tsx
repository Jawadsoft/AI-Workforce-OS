import { Zap } from 'lucide-react'

export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background gap-5">
      {/* Logo mark */}
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl scale-150" />
        <div className="relative w-14 h-14 rounded-full flex items-center justify-center bg-primary border border-primary/60 shadow-[0_0_28px_rgba(193,255,0,0.35)]">
          <Zap className="w-6 h-6 text-primary-foreground" />
        </div>
      </div>

      {/* Spinner ring */}
      <div className="w-8 h-8 rounded-full border-[3px] border-muted border-t-primary animate-spin" />

      {/* Text */}
      <p className="text-sm text-muted-foreground animate-pulse tracking-wide">
        Setting up your workspace…
      </p>
    </div>
  )
}
