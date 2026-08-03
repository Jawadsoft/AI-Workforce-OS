import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { ConfigService } from '@nestjs/config'

/** Keep Redis from blocking Nest boot when Redis is down (local Twilio work, etc.). */
function redisConnectionOptions(opts: {
  host: string
  port: number
  username?: string
  password?: string
  tls?: object
}) {
  return {
    ...opts,
    maxRetriesPerRequest: null as unknown as number,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    connectTimeout: 1500,
    lazyConnect: true,
    // Stop reconnect loops so missing local Redis does not crash the API process
    retryStrategy: () => null,
  }
}

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL')
        if (redisUrl) {
          const url = new URL(redisUrl)

          return {
            redis: redisConnectionOptions({
              host: url.hostname,
              port: Number(url.port || 6379),
              username: url.username || undefined,
              password: url.password ? decodeURIComponent(url.password) : undefined,
              tls: url.protocol === 'rediss:' ? {} : undefined,
            }),
          }
        }

        return {
          redis: redisConnectionOptions({
            host: config.get<string>('REDIS_HOST') ?? 'localhost',
            port: Number(config.get('REDIS_PORT') ?? 6379),
            password: config.get<string>('REDIS_PASSWORD') || undefined,
          }),
        }
      },
    }),
    BullModule.registerQueue(
      { name: 'ai-tasks' },
      { name: 'knowledge-processing' },
      { name: 'document-generation' },
      { name: 'email' },
      { name: 'webhooks' },
      { name: 'message-embedding' },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
