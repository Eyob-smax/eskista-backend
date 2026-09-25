import { Module } from '@nestjs/common';
import { AdminHiringController } from './admin-hiring.controller';
import { AdminPricingController } from './admin-pricing.controller';
import { AdminPricingService } from './admin-pricing.service';

@Module({
  controllers: [AdminPricingController, AdminHiringController],
  providers: [AdminPricingService],
})
export class AdminPricingModule {}
