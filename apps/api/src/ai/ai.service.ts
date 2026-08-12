import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenAIProvider } from './providers/openai.provider'
import type { ToolDefinition } from './providers/openai.provider'
import { ClaudeProvider } from './providers/claude.provider'
import { GeminiProvider } from './providers/gemini.provider'

export type AIProvider = 'openai' | 'claude' | 'gemini'
export type { ToolDefinition }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIResponse {
  content: string
  provider: AIProvider
  tokens?: number
}

@Injectable()
export class AIService {
  constructor(
    private readonly config: ConfigService,
    private readonly openai: OpenAIProvider,
    private readonly claude: ClaudeProvider,
    private readonly gemini: GeminiProvider,
  ) {}

  async complete(messages: ChatMessage[], provider?: AIProvider, options?: { temperature?: number; maxTokens?: number }): Promise<AIResponse> {
    const activeProvider = provider ?? (this.config.get<AIProvider>('DEFAULT_AI_PROVIDER') ?? 'openai')

    switch (activeProvider) {
      case 'claude':
        return this.claude.chat(messages)
      case 'gemini':
        return this.gemini.chat(messages)
      default:
        return this.openai.chat(messages, options)
    }
  }

  async *stream(messages: ChatMessage[], provider?: AIProvider): AsyncGenerator<string> {
    const activeProvider = provider ?? (this.config.get<AIProvider>('DEFAULT_AI_PROVIDER') ?? 'openai')

    switch (activeProvider) {
      case 'claude':
        yield* this.claude.stream(messages)
        break
      case 'gemini':
        yield* this.gemini.stream(messages)
        break
      default:
        yield* this.openai.stream(messages)
    }
  }

  async embed(text: string): Promise<number[]> {
    return this.openai.embed(text)
  }

  /** Transcribe audio (e.g. WhatsApp voice note) via OpenAI Whisper. */
  async transcribe(audio: Buffer, filename?: string): Promise<string> {
    return this.openai.transcribe(audio, filename)
  }

  /** Takes a system prompt + message history and returns the AI reply string */
  async chat(
    systemPrompt: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    provider?: AIProvider,
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
    ]
    const result = await this.complete(messages, provider, options)
    return result.content
  }

  /**
   * Chat with native OpenAI function calling — reliable tool execution
   * without stalling responses or JSON leaking to the user.
   */
  async chatWithTools(
    systemPrompt: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    tools: ToolDefinition[],
    executor: (name: string, params: Record<string, any>) => Promise<string>,
    maxRounds = 3,
  ): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
    ]
    return this.openai.chatWithTools(messages, tools, executor, maxRounds)
  }
}
