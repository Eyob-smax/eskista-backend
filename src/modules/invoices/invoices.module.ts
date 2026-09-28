import { Global, Module } from '@nestjs/common';
import { AdminInvoicesController, CustomerInvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

/**
 * Invoices, single and combined. Global because the single-booking payment screens issue
 * a booking's invoice on first use, and the admin payment review will update it.
 */
@Global()
@Module({
  controllers: [CustomerInvoicesController, AdminInvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
