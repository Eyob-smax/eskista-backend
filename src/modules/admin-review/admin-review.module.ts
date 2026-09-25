import { Module } from '@nestjs/common';
import { AdminReviewController } from './admin-review.controller';
import { AdminReviewService } from './admin-review.service';

@Module({
  controllers: [AdminReviewController],
  providers: [AdminReviewService],
})
export class AdminReviewModule {}
