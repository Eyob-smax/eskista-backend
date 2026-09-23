import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module';
import { BookingRequestService } from './booking-request.service';
import { CustomerBookingsController } from './customer-bookings.controller';
import { CustomerBookingsService } from './customer-bookings.service';

@Module({
  // CustomerModule so booking readiness re-uses the profile rules rather than copying them.
  imports: [CustomerModule],
  controllers: [CustomerBookingsController],
  providers: [CustomerBookingsService, BookingRequestService],
  exports: [CustomerBookingsService],
})
export class CustomerBookingsModule {}
