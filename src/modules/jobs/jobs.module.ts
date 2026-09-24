import { BullModule } from '@nestjs/bullmq';
import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { NotificationsModule } from '../notifications/notifications.module';
import { ESKISTA_QUEUE } from './jobs.constants';
import { JobsProcessor } from './jobs.processor';
import { JobsService } from './jobs.service';

/**
 * Background jobs, on the Redis that already backs the cache.
 *
 * One queue rather than one per job type: the volumes here are small, and a single queue
 * keeps the health check and the dead-letter view in one place.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = new URL(config.get('REDIS_URL', { infer: true }));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: url.username || undefined,
            password: url.password || undefined,
            // BullMQ requires this: with a retry limit, a blocking command that outlives
            // a reconnect throws instead of resuming, and the worker stalls silently.
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: ESKISTA_QUEUE }),
    NotificationsModule,
  ],
  providers: [JobsService, JobsProcessor],
  exports: [JobsService],
})
export class JobsModule implements OnApplicationBootstrap {
  constructor(private readonly jobs: JobsService) {}

  /**
   * Registers the nightly sweep once the app is up.
   *
   * On bootstrap rather than at module construction, because it talks to Redis and a
   * failure here must not stop the API serving requests that have nothing to do with jobs.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.installSweep();
  }
}
