import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { ConfigService } from '@nestjs/config'

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST') ?? 'localhost',
          port: config.get<number>('REDIS_PORT') ?? 6379,
          password: config.get('REDIS_PASSWORD'),
        },
      }),
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
