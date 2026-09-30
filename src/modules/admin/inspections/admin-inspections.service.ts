import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  BookingType,
  IncidentPhase,
  IncidentStatus,
  IncidentType,
  InspectionGrade,
  InspectionKind,
  InspectionOutcome,
  Prisma,
  Role,
} from '@prisma/client';
import { paginate, type Paginated } from '../../../common/dto/pagination.dto';
import { formatMoney } from '../../../common/money';
import {
  IMAGE_MIME_TYPES,
  UPLOAD_LIMITS,
  assertValidFile,
  type UploadedFile,
} from '../../../common/upload';
import { renderInspectionPdf } from '../../documents/inspection-renderer';
import { NotificationsService } from '../../notifications/notifications.service';
import { NumberingService } from '../../numbering/numbering.service';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../../storage/storage.interface';
import { AdminAuditService } from '../core/admin-audit.service';
import { BookingFlowService } from '../core/booking-flow.service';
import { InspectionResponse, InspectionsQuery, RecordInspectionDto } from './dto/inspection.dto';
import {
  GRADE_LABELS,
  conditionForGrade,
  depositAfterDeduction,
  unitStatusAfter,
} from './inspection-rules';

const MAX_PHOTOS = 6;

const KIND_LABELS: Record<InspectionKind, string> = {
  OUTGOING: 'Outgoing Check-out',
  RETURN: 'Post-Shoot Return',
  ROUTINE: 'Routine Service',
};

const inspectionInclude = {
  booking: { select: { reference: true, listing: { select: { name: true } } } },
  unit: { include: { listing: { select: { name: true } } } },
  inspectedBy: { select: { name: true } },
  photos: true,
} satisfies Prisma.InspectionInclude;

type InspectionRow = Prisma.InspectionGetPayload<{ include: typeof inspectionInclude }>;

/** Where a booking must be for each of its inspections. */
const OUTGOING_OPEN: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
];
const RETURN_OPEN: BookingStatus[] = [BookingStatus.RETURN_RECEIVED, BookingStatus.INSPECTION];

/**
 * Inspections & QA. Every inspection of a unit — the outgoing check before gear leaves the
 * hub, the return inspection when it comes back, routine service in between — and what each
 * does to the unit's condition and, for a return, to the customer's deposit.
 */
@Injectable()
export class AdminInspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flow: BookingFlowService,
    private readonly notifications: NotificationsService,
    private readonly numbering: NumberingService,
    private readonly audit: AdminAuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /**
   * Records, or corrects, a booking's outgoing or return inspection. Correcting is allowed
   * until the booking moves on: the outgoing check until the gear is delivered, the return
   * inspection until the booking is settled.
   */
  async recordForBooking(
    adminId: string,
    reference: string,
    kind: 'OUTGOING' | 'RETURN',
    dto: RecordInspectionDto,
    photos: UploadedFile[],
  ): Promise<InspectionResponse> {
    const booking = await this.prisma.booking.findUnique({
      where: { reference },
      include: {
        assignedUnits: { include: { unit: true } },
        handover: true,
        fulfilments: true,
        inspections: { where: { kind } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.type !== BookingType.EQUIPMENT) {
      throw new BadRequestException('Only equipment is inspected');
    }

    if (kind === InspectionKind.OUTGOING) {
      if (!OUTGOING_OPEN.includes(booking.status)) {
        throw new ConflictException(
          'The outgoing inspection is done once the booking is confirmed',
        );
      }
      const delivered = booking.fulfilments.some(
        (f) => f.direction === 'OUTBOUND' && f.stage === 'DELIVERED',
      );
      if (delivered) throw new ConflictException('The equipment has already been delivered');
      if (!booking.handover?.receivedAtHubAt) {
        throw new ConflictException('Receive the equipment at the hub before inspecting it');
      }
    } else if (!RETURN_OPEN.includes(booking.status)) {
      throw new ConflictException(
        'The return inspection is done once the equipment is back at the hub',
      );
    }

    const unitIds = booking.assignedUnits.map((u) => u.unitId);
    if (dto.unitId && !unitIds.includes(dto.unitId)) {
      throw new BadRequestException('That unit is not on this booking');
    }
    const unitId = dto.unitId ?? (unitIds.length === 1 ? unitIds[0] : null);

    const fee = kind === InspectionKind.RETURN ? (dto.deductionMinor ?? 0) : 0;
    let depositReturned = 0;
    if (kind === InspectionKind.RETURN) {
      try {
        depositReturned = depositAfterDeduction(booking.securityDepositMinor, fee);
      } catch (error) {
        throw new BadRequestException(
          `${(error as Error).message} (${formatMoney(booking.securityDepositMinor, booking.currency)}). ` +
            'Raise the rest as an incident.',
        );
      }
    }

    const keys = await this.storePhotos(
      photos,
      `bookings/${booking.reference}/inspections/${kind.toLowerCase()}`,
    );
    const outcome = kind === InspectionKind.RETURN ? (dto.outcome ?? this.outcomeFor(dto)) : null;
    const now = new Date();
    const fields = {
      grade: dto.grade,
      condition: conditionForGrade(dto.grade),
      notes: dto.notes ?? null,
      inspectorName: dto.inspectorName ?? null,
      unitId,
      physicalPassed: dto.physicalPassed ?? dto.grade !== InspectionGrade.DAMAGED,
      functionalPassed: dto.functionalPassed ?? true,
      outcome,
      missingItems: dto.missingItems ?? null,
      damageNotes: dto.damageNotes ?? null,
      feeMinor: fee,
      depositReturnedMinor: depositReturned,
      inspectedById: adminId,
      inspectedAt: now,
    };

    const inspection = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.inspection.upsert({
        where: { bookingId_kind: { bookingId: booking.id, kind } },
        create: { kind, bookingId: booking.id, ...fields },
        update: fields,
      });
      if (keys.length > 0) {
        await tx.inspectionPhoto.createMany({
          data: keys.map((fileKey) => ({ inspectionId: saved.id, fileKey })),
        });
      }
      await this.updateUnits(tx, unitId ? [unitId] : unitIds, dto.grade, now);

      if (kind === InspectionKind.RETURN && booking.status === BookingStatus.RETURN_RECEIVED) {
        await this.flow.move(
          booking.id,
          [BookingStatus.RETURN_RECEIVED],
          BookingStatus.INSPECTION,
          adminId,
          'Return inspection recorded',
          {},
          tx,
        );
      } else {
        await this.flow.note(
          booking.id,
          adminId,
          `${KIND_LABELS[kind]} inspection ${booking.inspections.length ? 'updated' : 'recorded'}: ${GRADE_LABELS[dto.grade]}`,
          undefined,
          tx,
        );
      }
      return saved;
    });

    if (kind === InspectionKind.RETURN) {
      if (dto.reportIssue) await this.raiseIncident(adminId, booking.id, dto, fee);
      await this.notifications.send(
        booking.customerId,
        'INSPECTION_COMPLETED',
        {
          reference: booking.reference,
          summary:
            fee > 0
              ? `${formatMoney(fee, booking.currency)} is withheld from your deposit. ${dto.damageNotes ?? ''}`
              : booking.securityDepositMinor > 0
                ? 'No issues found. Your full deposit will be returned.'
                : 'No issues found.',
        },
        { bookingReference: booking.reference },
      );
    }
    await this.audit.record(
      adminId,
      `inspection.${kind.toLowerCase()}`,
      'Booking',
      booking.reference,
      undefined,
      {
        grade: dto.grade,
        fee,
      },
    );
    return this.get(inspection.id);
  }

  /** A check on a unit outside any rental: "Staff Inspection", "Routine Service". */
  async recordRoutine(
    adminId: string,
    unitId: string,
    dto: RecordInspectionDto,
    photos: UploadedFile[],
  ): Promise<InspectionResponse> {
    const unit = await this.prisma.equipmentUnit.findUnique({ where: { id: unitId } });
    if (!unit) throw new NotFoundException('Unit not found');
    const keys = await this.storePhotos(photos, `inspections/${unitId}`);
    const now = new Date();

    const inspection = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.inspection.create({
        data: {
          kind: InspectionKind.ROUTINE,
          unitId,
          grade: dto.grade,
          condition: conditionForGrade(dto.grade),
          notes: dto.notes,
          inspectorName: dto.inspectorName,
          physicalPassed: dto.physicalPassed ?? dto.grade !== InspectionGrade.DAMAGED,
          functionalPassed: dto.functionalPassed ?? true,
          inspectedById: adminId,
          inspectedAt: now,
          photos: { create: keys.map((fileKey) => ({ fileKey })) },
        },
      });
      await this.updateUnits(tx, [unitId], dto.grade, now);
      return saved;
    });
    await this.audit.record(adminId, 'inspection.routine', 'EquipmentUnit', unitId, undefined, {
      grade: dto.grade,
    });
    return this.get(inspection.id);
  }

  async list(query: InspectionsQuery): Promise<Paginated<InspectionResponse>> {
    const where: Prisma.InspectionWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.grade ? { grade: query.grade } : {}),
      ...(query.flagged
        ? { grade: { in: [InspectionGrade.NEEDS_ATTENTION, InspectionGrade.DAMAGED] } }
        : {}),
      ...(query.from || query.to
        ? {
            inspectedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.inspection.findMany({
        where,
        include: inspectionInclude,
        orderBy: { inspectedAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.inspection.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.toResponse(r)),
      total,
      query,
    );
  }

  /** Condition History: every inspection of the unit, and of the bookings it went out on. */
  async unitHistory(unitId: string): Promise<InspectionResponse[]> {
    const rows = await this.prisma.inspection.findMany({
      where: {
        OR: [{ unitId }, { unitId: null, booking: { assignedUnits: { some: { unitId } } } }],
      },
      include: inspectionInclude,
      orderBy: { inspectedAt: 'desc' },
    });
    return rows.map((r) => this.toResponse(r));
  }

  async forBooking(bookingId: string): Promise<InspectionResponse[]> {
    const rows = await this.prisma.inspection.findMany({
      where: { bookingId },
      include: inspectionInclude,
      orderBy: { inspectedAt: 'asc' },
    });
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: string): Promise<InspectionResponse> {
    const row = await this.prisma.inspection.findUnique({
      where: { id },
      include: inspectionInclude,
    });
    if (!row) throw new NotFoundException('Inspection not found');
    return this.toResponse(row);
  }

  /** The inspection sheet — "Outgoing inspection sheet" under a booking's Documents. */
  async sheet(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const row = await this.prisma.inspection.findUnique({
      where: { id },
      include: inspectionInclude,
    });
    if (!row) throw new NotFoundException('Inspection not found');
    const r = this.toResponse(row);
    const buffer = await renderInspectionPdf({
      title: `${r.kindLabel} Inspection`,
      bookingReference: r.bookingReference,
      equipment: r.equipmentName,
      unit: r.unitLabel,
      serialNumber: r.serialNumber,
      rows: [
        { label: 'Condition', value: r.gradeLabel ?? '—' },
        { label: 'Physical condition', value: r.physicalPassed ? 'Passed' : 'Failed' },
        { label: 'Functional test', value: r.functionalPassed ? 'Passed' : 'Failed' },
        ...(r.kind === InspectionKind.RETURN
          ? [
              { label: 'Missing items', value: r.missingItems || 'None' },
              { label: 'Damage', value: r.damageNotes || 'None' },
              { label: 'Deduction', value: formatMoney(r.deductionMinor, row.currency) },
              {
                label: 'Deposit returned',
                value: formatMoney(r.depositReturnedMinor, row.currency),
              },
            ]
          : []),
      ],
      notes: r.notes,
      inspector: r.inspector,
      inspectedAt: row.inspectedAt,
      generatedAt: new Date(),
    });
    const name = `${r.bookingReference ?? r.unitLabel ?? 'unit'}-${r.kind.toLowerCase()}-inspection.pdf`;
    return { buffer, filename: name };
  }

  async removePhoto(
    adminId: string,
    inspectionId: string,
    photoId: string,
  ): Promise<InspectionResponse> {
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id: photoId, inspectionId },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.prisma.inspectionPhoto.delete({ where: { id: photo.id } });
    await this.storage.remove(photo.fileKey).catch(() => undefined);
    await this.audit.record(adminId, 'inspection.photo.remove', 'Inspection', inspectionId);
    return this.get(inspectionId);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private outcomeFor(dto: RecordInspectionDto): InspectionOutcome {
    if (dto.grade === InspectionGrade.DAMAGED || dto.damageNotes) return InspectionOutcome.DAMAGED;
    if (dto.missingItems) return InspectionOutcome.MISSING_ITEMS;
    return InspectionOutcome.OK;
  }

  private async updateUnits(
    tx: Prisma.TransactionClient,
    unitIds: string[],
    grade: InspectionGrade,
    at: Date,
  ): Promise<void> {
    for (const id of unitIds) {
      const unit = await tx.equipmentUnit.findUniqueOrThrow({ where: { id } });
      await tx.equipmentUnit.update({
        where: { id },
        data: {
          lastGrade: grade,
          lastInspectedAt: at,
          condition: conditionForGrade(grade),
          status: unitStatusAfter(grade, unit.status),
        },
      });
    }
  }

  private async raiseIncident(
    adminId: string,
    bookingId: string,
    dto: RecordInspectionDto,
    fee: number,
  ): Promise<void> {
    const reference = await this.numbering.nextIncidentReference();
    await this.prisma.incident.create({
      data: {
        reference,
        bookingId,
        reportedById: adminId,
        reporterRole: Role.ADMIN,
        type: dto.issueType ?? IncidentType.PHYSICAL_DAMAGE,
        phase: IncidentPhase.DURING_INSPECTION,
        description:
          dto.issueDescription ??
          dto.damageNotes ??
          dto.notes ??
          'Raised from the return inspection',
        amountMinor: fee > 0 ? fee : null,
        status: IncidentStatus.UNDER_REVIEW,
      },
    });
    await this.flow.note(
      bookingId,
      adminId,
      `Issue ${reference} raised from the return inspection`,
    );
  }

  private async storePhotos(files: UploadedFile[], folder: string): Promise<string[]> {
    if (files.length > MAX_PHOTOS) {
      throw new BadRequestException(`At most ${MAX_PHOTOS} photos per inspection`);
    }
    for (const file of files) {
      assertValidFile(file, {
        allowed: IMAGE_MIME_TYPES,
        maxBytes: UPLOAD_LIMITS.image,
        field: 'photos',
      });
    }
    const stored = await Promise.all(
      files.map((file) =>
        this.storage.put({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          folder,
        }),
      ),
    );
    return stored.map((s) => s.key);
  }

  private toResponse(r: InspectionRow): InspectionResponse {
    return {
      id: r.id,
      kind: r.kind,
      kindLabel: KIND_LABELS[r.kind],
      grade: r.grade,
      gradeLabel: r.grade ? GRADE_LABELS[r.grade] : null,
      bookingReference: r.booking?.reference ?? null,
      unitId: r.unitId,
      unitLabel: r.unit?.label ?? null,
      serialNumber: r.unit?.serialNumber ?? null,
      equipmentName: r.unit?.listing.name ?? r.booking?.listing?.name ?? 'Equipment',
      notes: r.notes ?? r.damageNotes,
      inspector: r.inspectorName ?? r.inspectedBy?.name ?? 'Eskista staff',
      physicalPassed: r.physicalPassed,
      functionalPassed: r.functionalPassed,
      outcome: r.outcome,
      missingItems: r.missingItems,
      damageNotes: r.damageNotes,
      deductionMinor: r.feeMinor,
      depositReturnedMinor: r.depositReturnedMinor,
      photoUrls: r.photos.map((p) => this.storage.urlFor(p.fileKey)),
      inspectedAt: r.inspectedAt.toISOString(),
      sheetUrl: `/api/v1/admin/inspections/${r.id}/sheet.pdf`,
    };
  }
}
