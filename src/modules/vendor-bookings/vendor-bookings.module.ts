import { Module } from '@nestjs/common';
import { VendorBookingsController } from './vendor-bookings.controller';
import { VendorBookingsService } from './vendor-bookings.service';

@Module({
  controllers: [VendorBookingsController],
  providers: [VendorBookingsService],
  exports: [VendorBookingsService],
})
export class VendorBookingsModule {}
