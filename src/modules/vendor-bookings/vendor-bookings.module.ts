import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { VendorBookingsController } from './vendor-bookings.controller';
import { VendorBookingsService } from './vendor-bookings.service';

@Module({
  imports: [JobsModule],
  controllers: [VendorBookingsController],
  providers: [VendorBookingsService],
  exports: [VendorBookingsService],
})
export class VendorBookingsModule {}
