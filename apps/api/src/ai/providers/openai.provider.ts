import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import type { ChatMessage, AIResponse } from '../ai.service'

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
}

export interface ToolCallResult {
  finalContent: string
  toolCalls: { name: string; params: Record<string, any> }[]
}

@Injectable()
export class OpenAIProvider {
  private client?: OpenAI

  constructor(private readonly config: ConfigService) {}

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = this.config.get<string>('OPENAI_API_KEY')
      if (!apiKey) throw new Error('OPENAI_API_KEY is required to use OpenAI features')
      this.client = new OpenAI({ apiKey })
    }
    return this.client
  }

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    const response = await this.getClient().chat.completions.create({
      model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
      messages,
    })
    return {
      content: response.choices[0].message.content ?? '',
      provider: 'openai',
      tokens: response.usage?.total_tokens,
    }
  }

  /**
   * Chat with native OpenAI function/tool calling.
   * Executes up to maxRounds of tool calls, invoking executor for each.
   * Returns the final natural-language response.
   */
  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    executor: (name: string, params: Record<string, any>) => Promise<string>,
    maxRounds = 3,
  ): Promise<string> {
    const model = this.config.get('OPENAI_MODEL') ?? 'gpt-4o'

    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))

    let currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    for (let round = 0; round < maxRounds; round++) {
      const response = await this.getClient().chat.completions.create({
        model,
        messages: currentMessages,
        tools: openaiTools,
        tool_choice: 'auto',
      })

      const choice = response.choices[0]
      const assistantMessage = choice.message

      // No tool calls — return final answer
      if (!assistantMessage.tool_calls?.length) {
        return assistantMessage.content ?? ''
      }

      // Add assistant message with tool calls
      currentMessages.push(assistantMessage as any)

      // Execute each tool call in parallel
      const toolResults = await Promise.all(
        assistantMessage.tool_calls.map(async tc => {
          let result = ''
          try {
            const params = JSON.parse(tc.function.arguments ?? '{}')
            result = await executor(tc.function.name, params)
          } catch (err: any) {
            result = `Error: ${err.message}`
          }
          return { toolCallId: tc.id, name: tc.function.name, result }
        })
      )

      // Add tool results back
      for (const tr of toolResults) {
        currentMessages.push({
          role: 'tool',
          tool_call_id: tr.toolCallId,
          content: tr.result,
        } as any)
      }
    }

    // Exceeded rounds — ask for final answer without tools
    const fallback = await this.getClient().chat.completions.create({
      model,
      messages: currentMessages,
    })
    return fallback.choices[0].message.content ?? ''
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    const stream = await this.getClient().chat.completions.create({
      model: this.config.get('OPENAI_MODEL') ?? 'gpt-4o',
      messages,
      stream: true,
    })
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) yield delta
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.getClient().embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    })
    return response.data[0].embedding
  }
}
