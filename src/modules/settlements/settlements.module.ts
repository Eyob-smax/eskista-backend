import { Global, Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { SettlementsService } from './settlements.service';

/**
 * Supplier payouts and closing settled bookings — shared by the vendor app, the talent app,
 * the customer's Complete Service, and the admin payout tools.
 */
@Global()
@Module({
  imports: [JobsModule],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
