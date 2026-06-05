const approvals = [
  { agent: 'Sales Assistant', action: 'Send follow-up email to Johnson Roofing', urgency: 'High' },
  { agent: 'Estimator', action: 'Update CRM record with estimate #1042', urgency: 'Medium' },
  { agent: 'Receptionist', action: 'Create task for field team', urgency: 'Low' },
]

export function PendingApprovals() {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-semibold mb-4">Pending Approvals <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded-full ml-2">{approvals.length}</span></h3>
      <div className="space-y-3">
        {approvals.map((item, i) => (
          <div key={i} className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{item.agent}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${item.urgency === 'High' ? 'bg-red-500/10 text-red-500' : item.urgency === 'Medium' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-muted text-muted-foreground'}`}>
                {item.urgency}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{item.action}</p>
            <div className="flex gap-2">
              <button className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded-md hover:bg-primary/90">Approve</button>
              <button className="text-xs border border-border px-3 py-1 rounded-md hover:bg-accent">Reject</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
