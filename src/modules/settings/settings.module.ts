import { Global, Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [SettingsService, PricingService],
  exports: [SettingsService, PricingService],
})
export class SettingsModule {}
