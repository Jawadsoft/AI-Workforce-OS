import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { ConfigService } from '@nestjs/config'

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL')
        if (redisUrl) {
          const url = new URL(redisUrl)

          return {
            redis: {
              host: url.hostname,
              port: Number(url.port || 6379),
              username: url.username || undefined,
              password: url.password ? decodeURIComponent(url.password) : undefined,
              tls: url.protocol === 'rediss:' ? {} : undefined,
            },
          }
        }

        return {
          redis: {
            host: config.get<string>('REDIS_HOST') ?? 'localhost',
            port: Number(config.get('REDIS_PORT') ?? 6379),
            password: config.get<string>('REDIS_PASSWORD') || undefined,
          },
        }
      },
    }),
    BullModule.registerQueue(
      { name: 'ai-tasks' },
      { name: 'knowledge-processing' },
      { name: 'document-generation' },
      { name: 'email' },
      { name: 'webhooks' },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
