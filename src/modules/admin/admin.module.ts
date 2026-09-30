import { Module } from '@nestjs/common';
import { AdminReviewModule } from '../admin-review/admin-review.module';
import { CustomerBookingsModule } from '../customer-bookings/customer-bookings.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { HiringModule } from '../hiring/hiring.module';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TalentModule } from '../talent/talent.module';
import { AdminAgreementsController, AdminAgreementsService } from './agreements/admin-agreements';
import { AdminBookingOpsService } from './bookings/admin-booking-ops.service';
import { AdminBookingsController } from './bookings/admin-bookings.controller';
import { AdminBookingsService } from './bookings/admin-bookings.service';
import {
  AdminCategoriesController,
  AdminEquipmentController,
} from './catalog/admin-catalog.controller';
import { AdminCategoriesService } from './catalog/admin-categories.service';
import { AdminEquipmentService } from './catalog/admin-equipment.service';
import { AdminTierGuard } from './core/admin-access';
import { AdminAuditService } from './core/admin-audit.service';
import { BookingFlowService } from './core/booking-flow.service';
import { AdminContentController, AdminContentService } from './governance/admin-content';
import { AdminSettingsController, AdminSettingsService } from './governance/admin-settings';
import { AdminHiringRequestsController, AdminHiringService } from './hiring/admin-hiring';
import { AdminIncidentsController, AdminIncidentsService } from './incidents/admin-incidents';
import { AdminInspectionsController } from './inspections/admin-inspections.controller';
import { AdminInspectionsService } from './inspections/admin-inspections.service';
import { AdminOverviewController, AdminOverviewService } from './overview/admin-overview';
import { AdminPaymentsController } from './payments/admin-payments.controller';
import { AdminPaymentsService } from './payments/admin-payments.service';
import { AdminSettlementsController } from './settlements/admin-settlements.controller';
import { AdminSettlementsService } from './settlements/admin-settlements.service';
import { AdminTalentController } from './talent/admin-talent.controller';
import { AdminTalentService } from './talent/admin-talent.service';
import { AdminTeamController } from './team/admin-team.controller';
import { AdminTeamService } from './team/admin-team.service';
import { AdminCustomersService } from './users/admin-customers.service';
import { AdminCustomersController, AdminVendorsController } from './users/admin-users.controller';
import { AdminVendorsService } from './users/admin-vendors.service';

/**
 * The operations dashboard, from the admin design sheets (docs/ADMIN-SIDE.md). Every
 * route is behind the ADMIN role and a role tier; see `AdminAccess`.
 */
@Module({
  imports: [
    NotificationsModule,
    JobsModule,
    HiringModule,
    CustomerBookingsModule,
    EquipmentModule,
    TalentModule,
    AdminReviewModule,
  ],
  controllers: [
    AdminOverviewController,
    AdminTeamController,
    AdminBookingsController,
    AdminAgreementsController,
    AdminInspectionsController,
    AdminPaymentsController,
    AdminSettlementsController,
    AdminHiringRequestsController,
    AdminTalentController,
    AdminEquipmentController,
    AdminCategoriesController,
    AdminVendorsController,
    AdminCustomersController,
    AdminContentController,
    AdminSettingsController,
    AdminIncidentsController,
  ],
  providers: [
    AdminTierGuard,
    AdminAuditService,
    BookingFlowService,
    AdminOverviewService,
    AdminTeamService,
    AdminBookingsService,
    AdminBookingOpsService,
    AdminAgreementsService,
    AdminInspectionsService,
    AdminPaymentsService,
    AdminSettlementsService,
    AdminHiringService,
    AdminTalentService,
    AdminEquipmentService,
    AdminCategoriesService,
    AdminVendorsService,
    AdminCustomersService,
    AdminContentService,
    AdminSettingsService,
    AdminIncidentsService,
  ],
})
export class AdminModule {}
