import { Module } from '@nestjs/common';
import { HiringModule } from '../hiring/hiring.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TalentClaimController, TalentClaimService } from './talent-claim';
import { TalentProfileController } from './talent-profile.controller';
import { TalentProfileService } from './talent-profile.service';
import { TalentWorkController } from './talent-work.controller';
import { TalentWorkService } from './talent-work.service';

/**
 * The creative-professional app: onboarding and profile, hire requests, engagements,
 * agreements, earnings and CV. See docs/TALENT-SIDE.md.
 */
@Module({
  imports: [HiringModule, NotificationsModule],
  controllers: [TalentProfileController, TalentWorkController, TalentClaimController],
  providers: [TalentProfileService, TalentWorkService, TalentClaimService],
  exports: [TalentProfileService, TalentWorkService],
})
export class TalentModule {}
