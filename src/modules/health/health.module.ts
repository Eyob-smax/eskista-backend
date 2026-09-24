import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { JobsModule } from '../jobs/jobs.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, JobsModule],
  controllers: [HealthController],
})
export class HealthModule {}
