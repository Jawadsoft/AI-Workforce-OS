import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class ElevenLabsProvider {
  private readonly logger = new Logger(ElevenLabsProvider.name)
  private readonly apiKey: string
  private readonly defaultVoiceId: string
  private readonly baseUrl = 'https://api.elevenlabs.io/v1'

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get('ELEVENLABS_API_KEY') ?? ''
    this.defaultVoiceId = this.config.get('ELEVENLABS_VOICE_ID') ?? '21m00Tcm4TlvDq8ikWAM'
  }

  /** Convert text to speech — returns audio buffer */
  async textToSpeech(text: string, voiceId?: string): Promise<Buffer> {
    const vid = voiceId ?? this.defaultVoiceId
    const response = await fetch(`${this.baseUrl}/text-to-speech/${vid}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      this.logger.error(`ElevenLabs TTS error: ${err}`)
      throw new Error(`ElevenLabs TTS failed: ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  /** List available voices */
  async getVoices(): Promise<any[]> {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: { 'xi-api-key': this.apiKey },
    })
    if (!response.ok) throw new Error('Failed to fetch ElevenLabs voices')
    const data: any = await response.json()
    return data.voices ?? []
  }

  /** Named agent voice mappings */
  getAgentVoiceId(agentName: string): string {
    const voiceMap: Record<string, string> = {
      'Rachel': '21m00Tcm4TlvDq8ikWAM',   // Rachel - calm, professional female
      'Stan':   'VR6AewLTigWG4xSOukaG',   // Arnold - confident male
      'Sonny':  'yoZ06aMxZJJ28mfd3POQ',   // Sam - friendly male
      'Ava':    'EXAVITQu4vr4xnSDxMaL',   // Bella - warm, authoritative female
      'Linda':  'MF3mGyEYCl7XYWbV9V6O',   // Elli - empathetic female
    }
    for (const [name, vid] of Object.entries(voiceMap)) {
      if (agentName.includes(name)) return vid
    }
    return this.defaultVoiceId
  }
}
