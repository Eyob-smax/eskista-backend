import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminTier,
  BookingStatus,
  IncidentPhase,
  IncidentStatus,
  IncidentType,
  Role,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import {
  IMAGE_MIME_TYPES,
  UPLOAD_LIMITS,
  assertValidFile,
  type UploadedFile,
} from '../../common/upload';
import { ApiStandardErrors } from '../../common/dto/api-docs';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';

export class SupplierIncidentDto {
  @ApiProperty({ enum: IncidentType, example: IncidentType.OVERTIME })
  @IsEnum(IncidentType)
  type!: IncidentType;

  @ApiProperty({ enum: IncidentPhase, example: IncidentPhase.DURING_ENGAGEMENT })
  @IsEnum(IncidentPhase)
  phase!: IncidentPhase;

  @ApiProperty({ example: 'The shoot ran three hours past the agreed 18:00 finish.' })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  description!: string;
}

export class SupplierIncidentPhotoResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '/api/v1/files/bookings/ESK-TLT-9001/incidents/a1.jpg' }) url!: string;
}

export class SupplierIncidentResponse {
  @ApiProperty({ example: 'ESK-INC-00043' }) reference!: string;
  @ApiProperty({ enum: IncidentType, example: IncidentType.OVERTIME }) type!: IncidentType;
  @ApiProperty({ enum: IncidentPhase, example: IncidentPhase.DURING_ENGAGEMENT })
  phase!: IncidentPhase;
  @ApiProperty({ enum: IncidentStatus, example: IncidentStatus.REPORTED }) status!: IncidentStatus;
  @ApiProperty({ example: 'The shoot ran three hours past the agreed 18:00 finish.' })
  description!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Eskista’s resolution, once resolved.' })
  resolution!: string | null;
  @ApiProperty({ type: [SupplierIncidentPhotoResponse] }) photos!: SupplierIncidentPhotoResponse[];
  @ApiProperty({ example: '2026-09-28T19:30:00.000Z' }) createdAt!: string;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: string | null;
}

/** Once there is an engagement or a rental to have gone wrong. */
const REPORTABLE: BookingStatus[] = [
  BookingStatus.BOOKING_CONFIRMED,
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
  BookingStatus.RETURN_RECEIVED,
  BookingStatus.INSPECTION,
  BookingStatus.SETTLEMENT,
  BookingStatus.CLOSED,
];

/**
 * Talents and vendors report problems on their own bookings — "late arrival", "overtime",
 * a return that came back wrong — to Eskista, which mediates. Never routed to the client.
 */
@Injectable()
export class SupplierIncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async report(
    userId: string,
    role: 'TALENT' | 'VENDOR',
    reference: string,
    dto: SupplierIncidentDto,
    files: UploadedFile[],
  ): Promise<SupplierIncidentResponse> {
    const booking = await this.booking(userId, role, reference);
    if (!REPORTABLE.includes(booking.status)) {
      throw new ConflictException('An issue can be reported once the booking is confirmed');
    }
    if (files.length > 6) throw new BadRequestException('At most 6 photos per report');
    for (const f of files) {
      assertValidFile(f, {
        allowed: IMAGE_MIME_TYPES,
        maxBytes: UPLOAD_LIMITS.image,
        field: 'photos',
      });
    }
    const stored = await Promise.all(
      files.map((f) =>
        this.storage.put({
          buffer: f.buffer,
          originalName: f.originalname,
          mimeType: f.mimetype,
          folder: `bookings/${booking.reference}/incidents`,
        }),
      ),
    );
    const incidentReference = await this.numbering.nextIncidentReference();
    const incident = await this.prisma.incident.create({
      data: {
        reference: incidentReference,
        bookingId: booking.id,
        reportedById: userId,
        reporterRole: role === 'TALENT' ? Role.TALENT : Role.VENDOR,
        type: dto.type,
        phase: dto.phase,
        description: dto.description,
        status: IncidentStatus.REPORTED,
        photos: { create: stored.map((s, i) => ({ fileKey: s.key, sortOrder: i })) },
      },
      include: { photos: true },
    });
    await this.notifications.send(
      userId,
      'INCIDENT_RECEIVED',
      { reference: incident.reference },
      {
        bookingReference: booking.reference,
        incidentReference: incident.reference,
      },
    );
    await this.notifications.notifyAdmins(
      'ADMIN_INCIDENT_REPORTED',
      {
        incident: incident.reference,
        reference: booking.reference,
        type: dto.type.toLowerCase().replace(/_/g, ' '),
      },
      { bookingReference: booking.reference, incidentReference: incident.reference },
      [AdminTier.SUPPORT, AdminTier.ADMIN],
    );
    return this.toResponse(incident);
  }

  async list(
    userId: string,
    role: 'TALENT' | 'VENDOR',
    reference: string,
  ): Promise<SupplierIncidentResponse[]> {
    const booking = await this.booking(userId, role, reference);
    const rows = await this.prisma.incident.findMany({
      where: { bookingId: booking.id, reportedById: userId },
      include: { photos: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toResponse(r));
  }

  private async booking(userId: string, role: 'TALENT' | 'VENDOR', reference: string) {
    const booking = await this.prisma.booking.findFirst({
      where:
        role === 'TALENT'
          ? { reference, talentProfile: { userId } }
          : { reference, vendor: { userId } },
      select: { id: true, reference: true, status: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private toResponse(i: {
    reference: string;
    type: IncidentType;
    phase: IncidentPhase;
    status: IncidentStatus;
    description: string;
    resolution: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
    photos: { id: string; fileKey: string }[];
  }): SupplierIncidentResponse {
    return {
      reference: i.reference,
      type: i.type,
      phase: i.phase,
      status: i.status,
      description: i.description,
      resolution: i.resolution,
      photos: i.photos.map((p) => ({ id: p.id, url: this.storage.urlFor(p.fileKey) })),
      createdAt: i.createdAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    };
  }
}

const DESCRIPTION =
  'Goes to Eskista, which mediates — never to the client. Multipart, with up to 6 `photos`.';

@ApiTags('talent')
@Roles('TALENT')
@Controller({ path: 'talent/bookings', version: '1' })
export class TalentIncidentsController {
  constructor(private readonly incidents: SupplierIncidentsService) {}

  @Post(':reference/incidents')
  @UseInterceptors(FilesInterceptor('photos', 6))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Report an issue — late arrival, overtime, conduct…',
    description: DESCRIPTION,
  })
  @ApiBody({
    description: 'JSON, or multipart/form-data with up to 6 `photos` (images).',
    schema: {
      type: 'object',
      required: ['type', 'phase', 'description'],
      properties: {
        type: { type: 'string', enum: Object.values(IncidentType), example: 'OVERTIME' },
        phase: { type: 'string', enum: Object.values(IncidentPhase), example: 'DURING_ENGAGEMENT' },
        description: {
          type: 'string',
          minLength: 10,
          example: 'The shoot ran three hours past the agreed 18:00 finish.',
        },
        photos: { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: 6 },
      },
    },
  })
  @ApiParam({ name: 'reference', example: 'ESK-TLT-9001' })
  @ApiOkResponse({ type: SupplierIncidentResponse })
  @ApiStandardErrors({
    badRequest: 'A field is invalid, or more than 6 photos.',
    notFound: 'Booking not found',
    conflict: 'An issue can be reported once the booking is confirmed',
  })
  report(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: SupplierIncidentDto,
    @UploadedFiles() photos: UploadedFile[] = [],
  ): Promise<SupplierIncidentResponse> {
    return this.incidents.report(userId, 'TALENT', reference, dto, photos ?? []);
  }

  @Get(':reference/incidents')
  @ApiOperation({ summary: 'My reports on this booking, newest first' })
  @ApiParam({ name: 'reference', example: 'ESK-TLT-9001' })
  @ApiOkResponse({ type: [SupplierIncidentResponse] })
  @ApiStandardErrors({ notFound: 'Booking not found' })
  list(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<SupplierIncidentResponse[]> {
    return this.incidents.list(userId, 'TALENT', reference);
  }
}

@ApiTags('vendor · bookings')
@Roles('VENDOR')
@Controller({ path: 'vendor/bookings', version: '1' })
export class VendorIncidentsController {
  constructor(private readonly incidents: SupplierIncidentsService) {}

  @Post(':reference/incidents')
  @UseInterceptors(FilesInterceptor('photos', 6))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'Report an issue with this rental', description: DESCRIPTION })
  @ApiBody({
    description: 'JSON, or multipart/form-data with up to 6 `photos` (images).',
    schema: {
      type: 'object',
      required: ['type', 'phase', 'description'],
      properties: {
        type: { type: 'string', enum: Object.values(IncidentType), example: 'PHYSICAL_DAMAGE' },
        phase: { type: 'string', enum: Object.values(IncidentPhase), example: 'DURING_RETURN' },
        description: {
          type: 'string',
          minLength: 10,
          example: 'The camera came back with a cracked LCD.',
        },
        photos: { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: 6 },
      },
    },
  })
  @ApiParam({ name: 'reference', example: 'ESK-10485' })
  @ApiOkResponse({ type: SupplierIncidentResponse })
  @ApiStandardErrors({
    badRequest: 'A field is invalid, or more than 6 photos.',
    notFound: 'Booking not found',
    conflict: 'An issue can be reported once the booking is confirmed',
  })
  report(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
    @Body() dto: SupplierIncidentDto,
    @UploadedFiles() photos: UploadedFile[] = [],
  ): Promise<SupplierIncidentResponse> {
    return this.incidents.report(userId, 'VENDOR', reference, dto, photos ?? []);
  }

  @Get(':reference/incidents')
  @ApiOperation({ summary: 'My reports on this booking, newest first' })
  @ApiParam({ name: 'reference', example: 'ESK-10485' })
  @ApiOkResponse({ type: [SupplierIncidentResponse] })
  @ApiStandardErrors({ notFound: 'Booking not found' })
  list(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<SupplierIncidentResponse[]> {
    return this.incidents.list(userId, 'VENDOR', reference);
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [TalentIncidentsController, VendorIncidentsController],
  providers: [SupplierIncidentsService],
})
export class SupplierIncidentsModule {}
