import { Global, Module } from '@nestjs/common';
import { AgreementsService } from './agreements.service';

/**
 * Global because both onboarding (vendor/talent) and booking flows issue agreements,
 * and nothing here holds request state.
 */
@Global()
@Module({
  providers: [AgreementsService],
  exports: [AgreementsService],
})
export class AgreementsModule {}
