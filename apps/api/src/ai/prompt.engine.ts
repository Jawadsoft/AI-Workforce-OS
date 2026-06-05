import { Injectable } from '@nestjs/common'

export interface PromptContext {
  masterPrompt: string
  industryRules: string
  businessRules: string
  agentRole: string
  agentPrompt: string
  knowledgeContext: string
  conversationHistory: Array<{ role: string; content: string }>
  crmContext?: string
}

@Injectable()
export class PromptEngine {
  build(ctx: PromptContext): string {
    return [
      `# MASTER INSTRUCTIONS\n${ctx.masterPrompt}`,
      `# INDUSTRY RULES\n${ctx.industryRules}`,
      `# BUSINESS RULES\n${ctx.businessRules}`,
      `# YOUR ROLE\nYou are a ${ctx.agentRole}.\n${ctx.agentPrompt}`,
      ctx.knowledgeContext
        ? `# RELEVANT KNOWLEDGE\n${ctx.knowledgeContext}`
        : '',
      ctx.crmContext
        ? `# CRM CONTEXT\n${ctx.crmContext}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  }
}
