import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  BookingType,
  CollectionMethod,
  DeliveryStage,
  FulfilmentDirection,
  FulfilmentMethod,
  InspectionKind,
  Prisma,
  Role,
  SettlementStatus,
  SupplierResponse,
  UnitCustody,
  UnitStatus,
} from '@prisma/client';
import { formatMoney } from '../../../common/money';
import { AgreementsService } from '../../agreements/agreements.service';
import { BookingWrapUpService } from '../../customer-bookings/booking-wrap-up.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { JOB_NAMES, jobIdFor } from '../../jobs/jobs.constants';
import { JobsService } from '../../jobs/jobs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettlementsService } from '../../settlements/settlements.service';
import { AdminAuditService } from '../core/admin-audit.service';
import { defaultDueAt } from '../core/booking-flow';
import { BookingFlowService } from '../core/booking-flow.service';
import { canDispatch } from '../inspections/inspection-rules';
import { ApproveBookingDto, DepositRefundDto, UpdateLegDto } from './dto/admin-booking-ops.dto';

/** Bookings whose dates hold a unit: approved and not yet over. */
export const HOLDS_UNIT: BookingStatus[] = [
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
  BookingStatus.RETURN_RECEIVED,
  BookingStatus.INSPECTION,
];

const PRE_APPROVAL: BookingStatus[] = [
  BookingStatus.REQUEST_SUBMITTED,
  BookingStatus.ESKISTA_REVIEW,
];
const CANCELLABLE: BookingStatus[] = [
  ...PRE_APPROVAL,
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.BOOKING_CONFIRMED,
];
const WITH_CUSTOMER: BookingStatus[] = [
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
];
const STAGE_ORDER: DeliveryStage[] = [
  DeliveryStage.PREPARED,
  DeliveryStage.PICKED_UP,
  DeliveryStage.OUT_FOR_DELIVERY,
  DeliveryStage.DELIVERED,
];

/** The courier details on a leg that an update may change. */
interface LegFields {
  address?: string;
  scheduledAt?: Date;
  etaAt?: Date;
  courierName?: string;
  courierPhone?: string;
  vehicleDescription?: string;
  vehiclePlate?: string;
  notes?: string;
}

const opsInclude = {
  listing: { select: { id: true, name: true } },
  talentProfile: { select: { id: true, userId: true, displayName: true } },
  vendor: { select: { id: true, userId: true, businessName: true } },
  equipmentDetail: true,
  assignedUnits: { include: { unit: true } },
  handover: true,
  fulfilments: true,
  inspections: true,
  settlement: true,
  payments: { select: { status: true, amountMinor: true } },
  agreements: { select: { status: true, counterpartyId: true, kind: true } },
} satisfies Prisma.BookingInclude;

type OpsBooking = Prisma.BookingGetPayload<{ include: typeof opsInclude }>;

/**
 * Eskista running a booking: approving it, assigning the physical unit, receiving the gear
 * from the vendor, checking it, sending it out, bringing it back, inspecting it, settling
 * with the supplier and closing. Equipment and talent alike — talent skips the gear.
 *
 * Each step checks the booking is where it should be, moves the status through
 * BookingFlowService so the customer, vendor and talent timelines follow, and tells whoever
 * the step concerns.
 */
@Injectable()
export class AdminBookingOpsService {
  private readonly logger = new Logger(AdminBookingOpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flow: BookingFlowService,
    private readonly agreements: AgreementsService,
    private readonly invoices: InvoicesService,
    private readonly settlements: SettlementsService,
    private readonly notifications: NotificationsService,
    private readonly wrapUp: BookingWrapUpService,
    private readonly jobs: JobsService,
    private readonly audit: AdminAuditService,
  ) {}

  // ── Approval ───────────────────────────────────────────────────────────────

  /**
   * Approve Booking. The vendor must have accepted first. Freezes the price, sets the
   * return deadline, holds a unit, and issues the customer's agreement and invoice: the
   * customer can sign and pay from here.
   */
  async approve(adminId: string, reference: string, dto: ApproveBookingDto): Promise<void> {
    const b = await this.load(reference);
    if (b.type !== BookingType.EQUIPMENT) {
      throw new BadRequestException('Talent requests are approved by hiring a talent');
    }
    if (!PRE_APPROVAL.includes(b.status))
      throw new ConflictException('This booking is not awaiting approval');
    if (b.supplierResponse !== SupplierResponse.ACCEPTED) {
      throw new ConflictException(
        b.supplierResponse === SupplierResponse.DECLINED
          ? 'The vendor declined this request'
          : 'Wait for the vendor to accept the request first',
      );
    }

    if (dto.unitIds?.length) await this.assignUnits(adminId, reference, dto.unitIds);
    else if (b.assignedUnits.length === 0) await this.autoAssign(b);

    const now = new Date();
    await this.flow.move(
      b.id,
      PRE_APPROVAL,
      BookingStatus.AWAITING_PAYMENT,
      adminId,
      dto.note ?? 'Approved by Eskista',
      {
        approvedById: adminId,
        approvedAt: now,
        pricedAt: b.pricedAt ?? now,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : (b.dueAt ?? defaultDueAt(b.endDate)),
      },
    );
    await this.agreements.issueForBooking(b.id);
    await this.invoices.ensureBookingInvoice(b.id);

    const item = b.listing?.name ?? 'equipment';
    await this.notifications.send(
      b.customerId,
      'BOOKING_APPROVED',
      { item },
      { bookingReference: reference },
    );
    await this.notifications.send(
      b.customerId,
      'AGREEMENT_READY',
      { reference },
      { bookingReference: reference },
    );
    if (b.vendor) {
      await this.notifications.send(
        b.vendor.userId,
        'SUPPLIER_BOOKING_APPROVED',
        { reference },
        {
          bookingReference: reference,
        },
      );
    }
    await this.audit.record(adminId, 'booking.approve', 'Booking', reference);
  }

  /** Reject Request, before approval. For a talent request, closes it for every invitee. */
  async reject(adminId: string, reference: string, reason: string): Promise<void> {
    const b = await this.load(reference);
    if (!PRE_APPROVAL.includes(b.status)) {
      throw new ConflictException(
        'Only a request not yet approved can be rejected; cancel it instead',
      );
    }
    await this.flow.move(b.id, PRE_APPROVAL, BookingStatus.REJECTED, adminId, reason, {
      rejectionReason: reason,
    });
    await this.wrapUp.wrapUp(b.id, reason, adminId, 'ADMIN');
    await this.notifications.send(
      b.customerId,
      'BOOKING_REJECTED',
      { reference, reason },
      {
        bookingReference: reference,
      },
    );
    await this.audit.record(
      adminId,
      'booking.reject',
      'Booking',
      reference,
      undefined,
      undefined,
      reason,
    );
  }

  /**
   * Cancels an approved booking before the gear or the talent is out. Money already verified
   * is reported back as `refundDueMinor` for finance to return; nothing is refunded here.
   */
  async cancel(
    adminId: string,
    reference: string,
    reason: string,
  ): Promise<{ refundDueMinor: number }> {
    const b = await this.load(reference);
    if (!CANCELLABLE.includes(b.status)) {
      throw new ConflictException('This booking is already under way and cannot be cancelled');
    }
    await this.flow.move(b.id, CANCELLABLE, BookingStatus.CANCELLED, adminId, reason, {
      cancelledAt: new Date(),
      cancelledById: adminId,
    });
    const { refundDueMinor } = await this.wrapUp.wrapUp(b.id, reason, adminId, 'ADMIN');

    await this.notifications.send(
      b.customerId,
      'BOOKING_CANCELLED_BY_ESKISTA',
      { reference, reason },
      { bookingReference: reference },
    );
    await this.audit.record(
      adminId,
      'booking.cancel',
      'Booking',
      reference,
      undefined,
      undefined,
      reason,
    );
    return { refundDueMinor };
  }

  // ── Units ──────────────────────────────────────────────────────────────────

  /**
   * Assign Unit: which physical copies go out. Replaces the current assignment. A unit
   * already held by another approved booking over these dates, retired, or blocked by the
   * vendor cannot be assigned.
   */
  async assignUnits(adminId: string, reference: string, unitIds: string[]): Promise<void> {
    const b = await this.load(reference);
    if (b.type !== BookingType.EQUIPMENT || !b.listingId) {
      throw new BadRequestException('Only equipment bookings have units');
    }
    if (
      ![...PRE_APPROVAL, BookingStatus.AWAITING_PAYMENT, BookingStatus.BOOKING_CONFIRMED].includes(
        b.status,
      )
    ) {
      throw new ConflictException('Units can only change before the equipment leaves the hub');
    }
    if (b.handover?.receivedAtHubAt) {
      throw new ConflictException('The equipment is already at the hub; its unit cannot change');
    }
    const quantity = b.equipmentDetail?.quantity ?? 1;
    if (unitIds.length > quantity) {
      throw new BadRequestException(
        `This booking is for ${quantity} unit${quantity === 1 ? '' : 's'}`,
      );
    }

    const units = await this.prisma.equipmentUnit.findMany({
      where: { id: { in: unitIds }, listingId: b.listingId },
    });
    if (units.length !== unitIds.length) {
      throw new BadRequestException('Every unit must belong to the booked equipment');
    }
    if (units.some((u) => u.status === UnitStatus.RETIRED)) {
      throw new ConflictException('A retired unit cannot be assigned');
    }
    const busy = await this.busyUnits(unitIds, b.startDate, b.endDate, b.id);
    if (busy.length > 0) {
      throw new ConflictException({
        message: 'Some units are taken on these dates',
        unitIds: busy,
      });
    }

    await this.prisma.$transaction([
      this.prisma.bookingUnit.deleteMany({ where: { bookingId: b.id } }),
      this.prisma.bookingUnit.createMany({
        data: unitIds.map((unitId) => ({ bookingId: b.id, unitId })),
      }),
    ]);
    await this.flow.note(
      b.id,
      adminId,
      `Unit assigned: ${units.map((u) => u.label ?? u.serialNumber ?? u.id.slice(0, 8)).join(', ')}`,
    );
  }

  /** Units of the listing free over the booking's dates, for the Assign Unit picker. */
  async freeUnits(
    reference: string,
  ): Promise<{ id: string; label: string | null; serialNumber: string | null; free: boolean }[]> {
    const b = await this.load(reference);
    if (!b.listingId) return [];
    const units = await this.prisma.equipmentUnit.findMany({
      where: { listingId: b.listingId, status: { not: UnitStatus.RETIRED } },
      orderBy: { createdAt: 'asc' },
    });
    const busy = new Set(
      await this.busyUnits(
        units.map((u) => u.id),
        b.startDate,
        b.endDate,
        b.id,
      ),
    );
    return units.map((u) => ({
      id: u.id,
      label: u.label,
      serialNumber: u.serialNumber,
      free: !busy.has(u.id) && u.status === UnitStatus.AVAILABLE,
    }));
  }

  // ── The gear's journey ─────────────────────────────────────────────────────

  /**
   * Eskista has the gear at its hub — the other side of the vendor's "Confirm Handover".
   * If the vendor never pressed it, receiving the gear confirms it for them.
   */
  async receiveAtHub(adminId: string, reference: string, note?: string): Promise<void> {
    const b = await this.load(reference);
    this.equipmentOnly(b);
    if (b.status !== BookingStatus.BOOKING_CONFIRMED) {
      throw new ConflictException('Gear is received once the booking is confirmed');
    }
    if (b.assignedUnits.length === 0) throw new ConflictException('Assign a unit first');
    if (b.handover?.receivedAtHubAt) return;

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.vendorHandover.upsert({
        where: { bookingId: b.id },
        create: { bookingId: b.id, checklist: [], handedOverAt: now, receivedAtHubAt: now },
        update: { receivedAtHubAt: now, handedOverAt: b.handover?.handedOverAt ?? now },
      }),
      this.prisma.equipmentUnit.updateMany({
        where: { id: { in: b.assignedUnits.map((u) => u.unitId) } },
        data: { custody: UnitCustody.HUB },
      }),
    ]);
    await this.flow.note(
      b.id,
      adminId,
      b.handover?.handedOverAt
        ? 'Received at the Eskista hub'
        : 'Received at the hub (handover confirmed by Eskista)',
      note ? { note } : undefined,
    );
  }

  /**
   * The delivery leg. The first call is "Start Packing Gear": it needs the gear at the hub
   * and a passing outgoing inspection, and moves the booking to Delivery / Pickup. Later calls
   * move the courier along; DELIVERED ("Handover Complete") starts the rental.
   */
  async updateDelivery(adminId: string, reference: string, dto: UpdateLegDto): Promise<void> {
    const b = await this.load(reference);
    this.equipmentOnly(b);
    let leg = b.fulfilments.find((f) => f.direction === FulfilmentDirection.OUTBOUND);

    if (!leg) {
      if (b.status !== BookingStatus.BOOKING_CONFIRMED) {
        throw new ConflictException('Delivery starts once the booking is confirmed');
      }
      if (!b.handover?.receivedAtHubAt)
        throw new ConflictException('Receive the gear at the hub first');
      const outgoing = b.inspections.find((i) => i.kind === InspectionKind.OUTGOING);
      if (!outgoing) throw new ConflictException('Record the outgoing inspection first');
      if (!canDispatch(outgoing.grade)) {
        throw new ConflictException('The outgoing inspection found damage; it cannot go out');
      }
      const pickup = b.equipmentDetail?.collectionMethod === CollectionMethod.PICKUP;
      leg = await this.prisma.$transaction(async (tx) => {
        const created = await tx.fulfilment.create({
          data: {
            bookingId: b.id,
            direction: FulfilmentDirection.OUTBOUND,
            method: pickup ? FulfilmentMethod.PICKUP : FulfilmentMethod.DELIVERY,
            address: dto.address ?? (pickup ? null : b.equipmentDetail?.deliveryAddress),
            stage: DeliveryStage.PREPARED,
            ...this.legDetails(dto),
          },
        });
        await this.flow.move(
          b.id,
          [BookingStatus.BOOKING_CONFIRMED],
          BookingStatus.DELIVERY_PICKUP,
          adminId,
          pickup ? 'Gear packed for studio pickup' : 'Gear packed for delivery',
          {},
          tx,
        );
        return created;
      });
    } else {
      await this.prisma.fulfilment.update({
        where: { id: leg.id },
        data: this.legDetails(dto, dto.address),
      });
    }

    if (dto.stage && dto.stage !== leg.stage) {
      await this.advance(
        adminId,
        b,
        leg.id,
        leg.stage,
        dto.stage,
        FulfilmentDirection.OUTBOUND,
        dto,
      );
    }
  }

  /**
   * The return leg. Arranges it on the customer's behalf if they have not, and moves it
   * along; DELIVERED is "Received by Eskista" — the booking goes to Return Received and the
   * gear back into the hub. "Mark Returned to Hub" is `{ stage: 'DELIVERED' }`.
   */
  async updateReturn(adminId: string, reference: string, dto: UpdateLegDto): Promise<void> {
    const b = await this.load(reference);
    this.equipmentOnly(b);
    let leg = b.fulfilments.find((f) => f.direction === FulfilmentDirection.RETURN);

    if (!leg) {
      if (!WITH_CUSTOMER.includes(b.status)) {
        throw new ConflictException('A return is arranged once the customer has the equipment');
      }
      const method =
        dto.returnMethod === 'SCHEDULED_PICKUP'
          ? FulfilmentMethod.SCHEDULED_PICKUP
          : FulfilmentMethod.DROP_OFF;
      leg = await this.prisma.$transaction(async (tx) => {
        const created = await tx.fulfilment.create({
          data: {
            bookingId: b.id,
            direction: FulfilmentDirection.RETURN,
            method,
            address: dto.address ?? null,
            stage: DeliveryStage.PREPARED,
            ...this.legDetails(dto),
          },
        });
        if (b.status !== BookingStatus.RETURN_SCHEDULED) {
          await this.flow.move(
            b.id,
            WITH_CUSTOMER,
            BookingStatus.RETURN_SCHEDULED,
            adminId,
            'Return arranged by Eskista',
            {},
            tx,
          );
        }
        return created;
      });
      await this.jobs.cancel(jobIdFor(JOB_NAMES.returnReminder, b.id));
    } else {
      await this.prisma.fulfilment.update({
        where: { id: leg.id },
        data: {
          ...this.legDetails(dto, dto.address),
          ...(dto.returnMethod
            ? {
                method:
                  dto.returnMethod === 'SCHEDULED_PICKUP'
                    ? FulfilmentMethod.SCHEDULED_PICKUP
                    : FulfilmentMethod.DROP_OFF,
              }
            : {}),
        },
      });
    }

    if (dto.stage && dto.stage !== leg.stage) {
      await this.advance(adminId, b, leg.id, leg.stage, dto.stage, FulfilmentDirection.RETURN, dto);
    }
  }

  /** Record Deposit Refund: the deposit, less any deduction, sent back to the customer. */
  async refundDeposit(adminId: string, reference: string, dto: DepositRefundDto): Promise<void> {
    const b = await this.load(reference);
    this.equipmentOnly(b);
    const inspection = b.inspections.find((i) => i.kind === InspectionKind.RETURN);
    if (!inspection) throw new ConflictException('Record the return inspection first');
    if (b.depositRefundedAt) throw new ConflictException('The deposit refund is already recorded');
    const amount = dto.amountMinor ?? inspection.depositReturnedMinor;
    if (amount > b.securityDepositMinor) {
      throw new BadRequestException('The refund cannot exceed the deposit held');
    }
    if (b.securityDepositMinor === 0) throw new ConflictException('This booking took no deposit');

    await this.prisma.booking.update({
      where: { id: b.id },
      data: {
        depositRefundMinor: amount,
        depositRefundedAt: new Date(),
        depositRefundReference: dto.reference,
      },
    });
    await this.flow.note(
      b.id,
      adminId,
      `Deposit refunded: ${formatMoney(amount, b.currency)} (${dto.reference})`,
      dto.note ? { note: dto.note } : undefined,
    );
    if (amount > 0) {
      await this.notifications.send(
        b.customerId,
        'DEPOSIT_REFUNDED',
        { amount: formatMoney(amount, b.currency), reference },
        { bookingReference: reference },
      );
    }
    await this.audit.record(adminId, 'booking.deposit_refund', 'Booking', reference, undefined, {
      amount,
      reference: dto.reference,
    });
  }

  /**
   * Move to Settlement: the supplier's payout is now owed. Equipment after the return
   * inspection; talent after the service is complete.
   */
  async settle(adminId: string, reference: string): Promise<void> {
    const b = await this.load(reference);
    if (b.type === BookingType.EQUIPMENT) {
      if (!b.inspections.some((i) => i.kind === InspectionKind.RETURN)) {
        throw new ConflictException('Record the return inspection first');
      }
      await this.flow.move(
        b.id,
        [BookingStatus.INSPECTION],
        BookingStatus.SETTLEMENT,
        adminId,
        'Rental settled',
      );
    } else {
      await this.flow.move(
        b.id,
        [BookingStatus.RENTAL_COMPLETED],
        BookingStatus.SETTLEMENT,
        adminId,
        'Engagement settled',
      );
    }
    const settlement = await this.settlements.ensureForBooking(b.id);
    // A payee who confirmed their payout before the booking reached Settlement (finance paid
    // early) had no auto-close scheduled then; start it now so the booking still closes.
    const confirmedAt = settlement.payeeConfirmedAt ?? b.handover?.payoutConfirmedAt;
    if (confirmedAt) await this.settlements.scheduleAutoClose(b.id, confirmedAt);
    await this.audit.record(adminId, 'booking.settle', 'Booking', reference);
  }

  /** Return Gear to Vendor. Optional: gear may stay at the hub for its next rental. */
  async returnToVendor(adminId: string, reference: string): Promise<void> {
    const b = await this.load(reference);
    this.equipmentOnly(b);
    if (
      !(
        [
          BookingStatus.INSPECTION,
          BookingStatus.SETTLEMENT,
          BookingStatus.CLOSED,
        ] as BookingStatus[]
      ).includes(b.status)
    ) {
      throw new ConflictException('Gear goes back to the vendor after its return inspection');
    }
    if (b.handover?.returnedToVendorAt) return;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.vendorHandover.upsert({
        where: { bookingId: b.id },
        create: { bookingId: b.id, checklist: [], returnedToVendorAt: now },
        update: { returnedToVendorAt: now },
      }),
      this.prisma.equipmentUnit.updateMany({
        where: { id: { in: b.assignedUnits.map((u) => u.unitId) }, custody: UnitCustody.HUB },
        data: { custody: UnitCustody.VENDOR },
      }),
    ]);
    await this.flow.note(b.id, adminId, 'Gear returned to the vendor');
  }

  /** Close Booking, once the supplier is paid — without waiting for them to press Complete. */
  async close(adminId: string, reference: string): Promise<void> {
    const b = await this.load(reference);
    if (b.settlement?.status !== SettlementStatus.PAID) {
      throw new ConflictException('Pay the supplier before closing the booking');
    }
    await this.settlements.close(b.id, adminId, Role.ADMIN);
    await this.audit.record(adminId, 'booking.close', 'Booking', reference);
  }

  // ── Talent engagements ─────────────────────────────────────────────────────

  /** Start Engagement: the day has come, both contracts are in force. */
  async startEngagement(adminId: string, reference: string): Promise<void> {
    const b = await this.load(reference);
    if (b.type !== BookingType.TALENT)
      throw new BadRequestException('Only talent engagements start this way');
    if (!this.flow.contractsApproved(b.agreements)) {
      throw new ConflictException("Both the client's and the talent's agreements must be approved");
    }
    await this.flow.move(
      b.id,
      [BookingStatus.BOOKING_CONFIRMED, BookingStatus.DELIVERY_PICKUP],
      BookingStatus.IN_PROGRESS,
      adminId,
      'Engagement started',
    );
  }

  /** Mark Completed on the client's behalf — the same as their Complete Service. */
  async completeEngagement(adminId: string, reference: string): Promise<void> {
    const b = await this.load(reference);
    if (b.type !== BookingType.TALENT)
      throw new BadRequestException('Only talent engagements complete this way');
    await this.flow.move(
      b.id,
      [BookingStatus.IN_PROGRESS, BookingStatus.DELIVERY_PICKUP],
      BookingStatus.RENTAL_COMPLETED,
      adminId,
      'Eskista confirmed the service was delivered',
    );
    await this.settlements.ensureForBooking(b.id);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async advance(
    adminId: string,
    b: OpsBooking,
    legId: string,
    from: DeliveryStage,
    to: DeliveryStage,
    direction: FulfilmentDirection,
    dto: UpdateLegDto,
  ): Promise<void> {
    if (STAGE_ORDER.indexOf(to) < STAGE_ORDER.indexOf(from)) {
      throw new BadRequestException('A delivery cannot move backwards');
    }
    const now = new Date();
    const unitIds = b.assignedUnits.map((u) => u.unitId);

    await this.prisma.$transaction(async (tx) => {
      await tx.fulfilment.update({
        where: { id: legId },
        data: {
          stage: to,
          ...(to === DeliveryStage.PICKED_UP || to === DeliveryStage.OUT_FOR_DELIVERY
            ? { dispatchedAt: now }
            : {}),
          ...(to === DeliveryStage.DELIVERED ? { completedAt: now } : {}),
        },
      });

      if (to !== DeliveryStage.DELIVERED) {
        await this.flow.note(
          b.id,
          adminId,
          `${direction === 'RETURN' ? 'Return' : 'Delivery'}: ${to.toLowerCase().replace(/_/g, ' ')}`,
          undefined,
          tx,
        );
        return;
      }
      if (direction === FulfilmentDirection.OUTBOUND) {
        await this.flow.move(
          b.id,
          [BookingStatus.DELIVERY_PICKUP],
          BookingStatus.IN_PROGRESS,
          adminId,
          'Handover complete: rental active',
          {},
          tx,
        );
        await tx.equipmentUnit.updateMany({
          where: { id: { in: unitIds } },
          data: { custody: UnitCustody.CLIENT },
        });
      } else {
        await this.flow.move(
          b.id,
          WITH_CUSTOMER,
          BookingStatus.RETURN_RECEIVED,
          adminId,
          'Equipment received back at the hub',
          {},
          tx,
        );
        await tx.equipmentUnit.updateMany({
          where: { id: { in: unitIds } },
          data: { custody: UnitCustody.HUB },
        });
      }
    });

    const item = b.listing?.name ?? 'equipment';
    if (direction === FulfilmentDirection.OUTBOUND) {
      if (to === DeliveryStage.OUT_FOR_DELIVERY) {
        const eta = dto.etaAt ? new Date(dto.etaAt) : null;
        await this.notifications.send(
          b.customerId,
          'OUT_FOR_DELIVERY',
          { eta: eta ? eta.toISOString().slice(0, 16).replace('T', ' ') : 'soon' },
          { bookingReference: b.reference },
        );
      }
      if (to === DeliveryStage.DELIVERED) {
        await this.notifications.send(
          b.customerId,
          'DELIVERED',
          { item },
          { bookingReference: b.reference },
        );
        // "Your rental ends tomorrow" — a day before the return deadline.
        await this.jobs
          .scheduleReturnReminder(b.id, b.dueAt ?? defaultDueAt(b.endDate))
          .catch((error: unknown) =>
            this.logger.warn(`Return reminder not scheduled: ${String(error)}`),
          );
      }
    } else if (to === DeliveryStage.DELIVERED) {
      await this.jobs.cancel(jobIdFor(JOB_NAMES.returnReminder, b.id));
    }
  }

  private legDetails(dto: UpdateLegDto, address?: string): LegFields {
    return {
      ...(address !== undefined ? { address } : {}),
      ...(dto.scheduledAt ? { scheduledAt: new Date(dto.scheduledAt) } : {}),
      ...(dto.etaAt ? { etaAt: new Date(dto.etaAt) } : {}),
      ...(dto.courierName !== undefined ? { courierName: dto.courierName } : {}),
      ...(dto.courierPhone !== undefined ? { courierPhone: dto.courierPhone } : {}),
      ...(dto.vehicleDescription !== undefined
        ? { vehicleDescription: dto.vehicleDescription }
        : {}),
      ...(dto.vehiclePlate !== undefined ? { vehiclePlate: dto.vehiclePlate } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };
  }

  /** Picks free units for a booking that has none, when enough are free. */
  private async autoAssign(b: OpsBooking): Promise<void> {
    if (!b.listingId) return;
    const quantity = b.equipmentDetail?.quantity ?? 1;
    const units = await this.prisma.equipmentUnit.findMany({
      where: { listingId: b.listingId, status: UnitStatus.AVAILABLE },
      orderBy: [{ lastInspectedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const busy = new Set(
      await this.busyUnits(
        units.map((u) => u.id),
        b.startDate,
        b.endDate,
        b.id,
      ),
    );
    const free = units.filter((u) => !busy.has(u.id)).slice(0, quantity);
    if (free.length < quantity) return; // left for the admin to sort out on Assign Unit
    await this.prisma.bookingUnit.createMany({
      data: free.map((u) => ({ bookingId: b.id, unitId: u.id })),
      skipDuplicates: true,
    });
  }

  /** Units held by another approved booking overlapping these dates, or blocked by the vendor. */
  private async busyUnits(
    unitIds: string[],
    start: Date,
    end: Date,
    exceptBookingId: string,
  ): Promise<string[]> {
    if (unitIds.length === 0) return [];
    const [held, blocked] = await Promise.all([
      this.prisma.bookingUnit.findMany({
        where: {
          unitId: { in: unitIds },
          bookingId: { not: exceptBookingId },
          booking: { status: { in: HOLDS_UNIT }, startDate: { lte: end }, endDate: { gte: start } },
        },
        select: { unitId: true },
      }),
      this.prisma.blockedDateRange.findMany({
        where: { unitId: { in: unitIds }, startDate: { lte: end }, endDate: { gte: start } },
        select: { unitId: true },
      }),
    ]);
    return [...new Set([...held.map((h) => h.unitId), ...blocked.map((x) => x.unitId!)])];
  }

  private equipmentOnly(b: OpsBooking): void {
    if (b.type !== BookingType.EQUIPMENT)
      throw new BadRequestException('Only equipment bookings have gear to move');
  }

  private async load(reference: string): Promise<OpsBooking> {
    const b = await this.prisma.booking.findUnique({ where: { reference }, include: opsInclude });
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }
}
