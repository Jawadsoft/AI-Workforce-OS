import { Injectable } from '@nestjs/common'
import { AIService } from './ai.service'

export type Intent =
  | 'generate_estimate'
  | 'create_material_list'
  | 'storm_lookup'
  | 'create_note'
  | 'create_task'
  | 'generate_report'
  | 'schedule_appointment'
  | 'crm_update'
  | 'send_email'
  | 'upload_document'
  | 'general_chat'

export interface IntentResult {
  intent: Intent
  confidence: number
  requiresApproval: boolean
  parameters: Record<string, unknown>
}

const APPROVAL_REQUIRED_INTENTS: Intent[] = [
  'crm_update',
  'send_email',
  'upload_document',
  'create_note',
]

@Injectable()
export class IntentEngine {
  constructor(private readonly ai: AIService) {}

  async detect(userMessage: string, agentRole: string): Promise<IntentResult> {
    const prompt = `You are an intent classifier for an AI employee platform.
Agent role: ${agentRole}
User message: "${userMessage}"

Classify the intent. Respond with JSON only:
{
  "intent": "<intent>",
  "confidence": <0-1>,
  "parameters": {}
}

Valid intents: generate_estimate, create_material_list, storm_lookup, create_note, create_task, generate_report, schedule_appointment, crm_update, send_email, upload_document, general_chat`

    const response = await this.ai.complete([{ role: 'user', content: prompt }])

    try {
      const parsed = JSON.parse(response.content) as IntentResult
      parsed.requiresApproval = APPROVAL_REQUIRED_INTENTS.includes(parsed.intent)
      return parsed
    } catch {
      return {
        intent: 'general_chat',
        confidence: 1,
        requiresApproval: false,
        parameters: {},
      }
    }
  }
}
