import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AdminTier, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../auth/auth.decorators';
import { AdminAccess } from '../admin/core/admin-access';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';

export class HiringSettingsResponse {
  @ApiProperty({ description: 'Talents one request may invite.', example: 5 })
  maxInvitations!: number;
  @ApiProperty({ description: 'Hours an invited talent has to answer.', example: 48 })
  invitationTtlHours!: number;
  @ApiProperty({
    description: 'Hours the customer has to choose, from the first acceptance.',
    example: 72,
  })
  selectionTtlHours!: number;
}

export class UpdateHiringSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 20, example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxInvitations?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 720, example: 48 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  invitationTtlHours?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 720, example: 72 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  selectionTtlHours?: number;

  @ApiPropertyOptional({
    description: 'Why — kept in the audit log.',
    maxLength: 500,
    example: 'Talents asked for more time to answer during the holiday season.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  reason?: string;
}

/**
 * The three limits on a multi-talent hire request. Changes apply to requests sent from now
 * on; a request already out keeps the deadlines it was given.
 */
@ApiTags('admin · settings')
@AdminAccess()
@Controller({ path: 'admin/settings/hiring', version: '1' })
export class AdminHiringController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @ApiEndpoint({
    summary: 'Talent hire limits',
    does: 'The three limits on a multi-talent hire request: max invitations, response deadline, and selection deadline.',
    behind: [
      'Read only. Changes apply to requests submitted from now on; a request already out keeps the deadlines it was given.',
    ],
  })
  @ApiOkResponse({ type: HiringSettingsResponse })
  get(): Promise<HiringSettingsResponse> {
    return this.settings.hiring();
  }

  @Patch()
  @ApiEndpoint({
    summary: 'Change the talent hire limits',
    does: 'Send only what changes. Applies to requests submitted from now on — deadlines already given are kept.',
    behind: [
      'Settings upserted in the key-value table; in-memory cache invalidated.',
      'Admin audit log written (before and after, with optional reason).',
    ],
    rules: ['Super Admins only.'],
  })
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOkResponse({ type: HiringSettingsResponse })
  @ApiStandardErrors({ badRequest: 'A limit is out of range (invitations 1–20, hours 1–720).' })
  async update(
    @CurrentUser('id') adminId: string,
    @Body() dto: UpdateHiringSettingsDto,
  ): Promise<HiringSettingsResponse> {
    const before = await this.settings.hiring();
    const changes: [string, number][] = [];
    if (dto.maxInvitations !== undefined)
      changes.push([SETTING_KEYS.maxInvitations, dto.maxInvitations]);
    if (dto.invitationTtlHours !== undefined) {
      changes.push([SETTING_KEYS.invitationTtlHours, dto.invitationTtlHours]);
    }
    if (dto.selectionTtlHours !== undefined) {
      changes.push([SETTING_KEYS.selectionTtlHours, dto.selectionTtlHours]);
    }

    await this.prisma.$transaction(
      changes.map(([key, value]) =>
        this.prisma.platformSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
    this.settings.invalidate();

    const after = await this.settings.hiring();
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action: 'hiring.settings.update',
        entityType: 'PlatformSetting',
        entityId: 'hiring',
        before: before as unknown as Prisma.InputJsonValue,
        after: after as unknown as Prisma.InputJsonValue,
        reason: dto.reason,
      },
    });
    return after;
  }
}
