import { SettingsTabs } from '@/components/settings/settings-tabs'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your workspace and platform settings.</p>
      </div>
      <SettingsTabs />
    </div>
  )
}
