import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The admin audit trail: who changed what, from what, to what, and why. Booking
 * transitions have their own trail in BookingStatusEvent; this covers everything else.
 *
 * Never throws — an action that succeeded must not report failure because its audit row
 * could not be written. The failure is logged instead.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    adminId: string,
    action: string,
    entityType: string,
    entityId: string,
    before?: unknown,
    after?: unknown,
    reason?: string,
  ): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          adminId,
          action,
          entityType,
          entityId,
          before: before === undefined ? Prisma.JsonNull : (before as Prisma.InputJsonValue),
          after: after === undefined ? Prisma.JsonNull : (after as Prisma.InputJsonValue),
          reason,
        },
      });
    } catch (error) {
      this.logger.error(`Could not audit ${action} on ${entityType}/${entityId}: ${String(error)}`);
    }
  }
}
