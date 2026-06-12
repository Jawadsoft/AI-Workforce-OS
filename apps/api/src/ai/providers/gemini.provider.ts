import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ChatMessage, AIResponse } from '../ai.service'

@Injectable()
export class GeminiProvider {
  private client?: GoogleGenerativeAI

  constructor(private readonly config: ConfigService) {}

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      const apiKey = this.config.get<string>('GEMINI_API_KEY')
      if (!apiKey) throw new Error('GEMINI_API_KEY is required to use Gemini features')
      this.client = new GoogleGenerativeAI(apiKey)
    }
    return this.client
  }

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    const model = this.getClient().getGenerativeModel({
      model: this.config.get('GEMINI_MODEL') ?? 'gemini-1.5-pro',
    })

    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const result = await model.generateContent(prompt)

    return {
      content: result.response.text(),
      provider: 'gemini',
    }
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    const model = this.getClient().getGenerativeModel({
      model: this.config.get('GEMINI_MODEL') ?? 'gemini-1.5-pro',
    })

    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const result = await model.generateContentStream(prompt)

    for await (const chunk of result.stream) {
      yield chunk.text()
    }
  }
}
