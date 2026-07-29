export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black relative overflow-hidden">
      {/* Lime ambient glow */}
      <div className="absolute top-[-80px] left-[-80px] w-[480px] h-[480px] rounded-full bg-[#C1FF00]/[0.08] blur-[120px] animate-pulse" />
      <div
        className="absolute bottom-[-60px] right-[-60px] w-[360px] h-[360px] rounded-full bg-[#C1FF00]/[0.06] blur-[100px] animate-pulse"
        style={{ animationDelay: '1.5s' }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#C1FF00]/[0.04] blur-[140px]" />

      {/* Grid overlay for subtle texture */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="w-full max-w-sm px-4 relative z-10">{children}</div>
    </div>
  )
}
