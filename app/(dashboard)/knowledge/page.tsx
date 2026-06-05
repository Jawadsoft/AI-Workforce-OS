import { KnowledgeBase } from '@/components/knowledge/knowledge-base'
import { KnowledgeUpload } from '@/components/knowledge/knowledge-upload'

export default function KnowledgePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-muted-foreground">Documents your AI workforce can learn from.</p>
        </div>
        <KnowledgeUpload />
      </div>
      <KnowledgeBase />
    </div>
  )
}
