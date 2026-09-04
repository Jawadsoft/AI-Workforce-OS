export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-[-100px] right-[-100px] w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-80px] left-[-80px] w-[480px] h-[480px] rounded-full bg-violet-500/08 blur-[120px] pointer-events-none" />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
