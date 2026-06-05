import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Anthropic from '@anthropic-ai/sdk'
import type { ChatMessage, AIResponse } from '../ai.service'

@Injectable()
export class ClaudeProvider {
  private client: Anthropic

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY') })
  }

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    const system = messages.find((m) => m.role === 'system')?.content
    const userMessages = messages.filter((m) => m.role !== 'system')

    const response = await this.client.messages.create({
      model: this.config.get('CLAUDE_MODEL') ?? 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system,
      messages: userMessages as Anthropic.MessageParam[],
    })

    return {
      content: (response.content[0] as Anthropic.TextBlock).text,
      provider: 'claude',
    }
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    const system = messages.find((m) => m.role === 'system')?.content
    const userMessages = messages.filter((m) => m.role !== 'system')

    const stream = this.client.messages.stream({
      model: this.config.get('CLAUDE_MODEL') ?? 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system,
      messages: userMessages as Anthropic.MessageParam[],
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }
  }
}
