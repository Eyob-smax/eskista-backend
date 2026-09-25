import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HiringService } from './hiring.service';

/**
 * The multi-talent hire, shared by the customer app (invite, choose) and the talent app
 * (accept, decline). No controllers of its own: each side exposes it under its own path.
 */
@Module({
  imports: [JobsModule, NotificationsModule],
  providers: [HiringService],
  exports: [HiringService],
})
export class HiringModule {}
