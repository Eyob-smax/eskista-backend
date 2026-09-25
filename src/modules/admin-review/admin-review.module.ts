import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminReviewController } from './admin-review.controller';
import { AdminReviewService } from './admin-review.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AdminReviewController],
  providers: [AdminReviewService],
})
export class AdminReviewModule {}
