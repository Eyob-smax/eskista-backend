import { Module } from '@nestjs/common';
import { AdminPricingController } from './admin-pricing.controller';
import { AdminPricingService } from './admin-pricing.service';

@Module({
  controllers: [AdminPricingController],
  providers: [AdminPricingService],
})
export class AdminPricingModule {}
