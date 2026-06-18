import { Module } from '@nestjs/common'
import { AIService } from './ai.service'
import { IntentEngine } from './intent.engine'
import { PromptEngine } from './prompt.engine'
import { OpenAIProvider } from './providers/openai.provider'
import { ClaudeProvider } from './providers/claude.provider'
import { GeminiProvider } from './providers/gemini.provider'
import { ElevenLabsProvider } from './providers/elevenlabs.provider'

@Module({
  providers: [AIService, IntentEngine, PromptEngine, OpenAIProvider, ClaudeProvider, GeminiProvider, ElevenLabsProvider],
  exports: [AIService, IntentEngine, PromptEngine, ElevenLabsProvider],
})
export class AIModule {}