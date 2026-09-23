import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

@Module({
  controllers: [CustomerController],
  providers: [CustomerService],
  // Exported because the booking service re-checks the same booking-readiness rules
  // rather than keeping a second copy of them.
  exports: [CustomerService],
})
export class CustomerModule {}
