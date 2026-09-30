import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module';
import { CustomerModule } from '../customer/customer.module';
import { HiringModule } from '../hiring/hiring.module';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingLifecycleController } from './booking-lifecycle.controller';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { BookingRequestService } from './booking-request.service';
import { CustomerBookingsController } from './customer-bookings.controller';
import { CustomerBookingsService } from './customer-bookings.service';

@Module({
  // CustomerModule so booking readiness re-uses the profile rules rather than copying them.
  imports: [CustomerModule, AgreementsModule, NotificationsModule, JobsModule, HiringModule],
  controllers: [CustomerBookingsController, BookingLifecycleController],
  providers: [CustomerBookingsService, BookingRequestService, BookingLifecycleService],
  exports: [CustomerBookingsService, BookingRequestService],
})
export class CustomerBookingsModule {}
