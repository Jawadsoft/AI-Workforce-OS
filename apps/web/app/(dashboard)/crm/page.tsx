import { CRMConnections } from '@/components/crm/crm-connections'

export default function CRMPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">CRM Connections</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Connect your CRM platforms to your AI workforce.</p>
      </div>
      <CRMConnections />
    </div>
  )
}
