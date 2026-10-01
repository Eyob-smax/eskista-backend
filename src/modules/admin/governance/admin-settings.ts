import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import { AccountChannel, AdminTier, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiStandardErrors } from '../../../common/dto/api-docs';
import { CurrentUser } from '../../auth/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { SETTING_KEYS, SettingsService } from '../../settings/settings.service';
import { AdminAccess } from '../core/admin-access';
import { AdminAuditService } from '../core/admin-audit.service';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class OperatingAccountDto {
  @ApiProperty({ enum: AccountChannel, description: 'Bank or wallet.' })
  @IsEnum(AccountChannel)
  channel!: AccountChannel;

  @ApiProperty({ example: 'Awash Bank' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Transform(trim)
  provider!: string;

  @ApiProperty({ example: 'Eskista Marketplace PLC', description: 'Account holder.' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  accountName!: string;

  @ApiProperty({ example: '01320012345600' })
  @Matches(/^\+?[0-9 -]{4,34}$/, { message: 'accountNumber must be digits' })
  @Transform(trim)
  accountNumber!: string;

  @ApiPropertyOptional({ example: '882910', description: 'Telebirr merchant ID.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  merchantId?: string;

  @ApiPropertyOptional({ default: true, description: 'Shown to customers.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOperatingAccountDto extends PartialType(OperatingAccountDto) {}

export class OrderDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class CompanyDetailsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) @Transform(trim) tin?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  vatNumber?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) @Transform(trim) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
}

export class GeneralSettingsDto {
  @ApiPropertyOptional({ description: 'Days after a booking is settled that its payout is due.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  payoutDelayDays?: number;

  @ApiPropertyOptional({ description: 'The number behind every Contact Eskista button.' })
  @IsOptional()
  @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'supportPhone must be a phone number' })
  supportPhone?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['09:00', '14:00'],
    description: 'Return drop-off times.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true, message: 'each time must be HH:MM' })
  returnSlotTimes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'The bullets on the Return Equipment screen.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  returnInstructions?: string[];

  @ApiPropertyOptional({
    type: CompanyDetailsDto,
    description: 'Printed at the top of every invoice.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyDetailsDto)
  company?: CompanyDetailsDto;
}

/**
 * System Settings beyond pricing (which lives at `/admin/pricing`): Eskista's operating
 * accounts — where customers pay — and the general knobs.
 */
export class OperatingAccountResponse {
  @ApiProperty({ format: 'uuid', description: 'Customers send it as `collectionAccountId`.' }) id!: string;
  @ApiProperty({ enum: AccountChannel, example: AccountChannel.BANK }) channel!: AccountChannel;
  @ApiProperty({ example: 'Commercial Bank of Ethiopia' }) provider!: string;
  @ApiProperty({ example: 'Eskista Marketplace PLC' }) accountName!: string;
  @ApiProperty({ example: '1000234567890' }) accountNumber!: string;
  @ApiPropertyOptional({ nullable: true, example: null }) merchantId!: string | null;
  @ApiProperty({ example: true, description: 'Shown on the payment screens.' }) isActive!: boolean;
  @ApiProperty({ example: 1 }) sortOrder!: number;
  @ApiProperty({ example: 12, description: 'Payments recorded against it; such an account is only deactivated, never deleted.' })
  payments!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class CompanyDetailsResponse {
  @ApiProperty({ example: 'Eskista Marketplace PLC' }) legalName!: string;
  @ApiPropertyOptional({ nullable: true, example: '0001234567' }) tin!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'VAT-0099887' }) vatNumber!: string | null;
  @ApiProperty({ example: 'Addis Ababa, Ethiopia' }) address!: string;
  @ApiProperty({ example: '+251966554411' }) phone!: string;
  @ApiPropertyOptional({ nullable: true, example: 'billing@eskista.et' }) email!: string | null;
}

export class PricingSummaryResponse {
  @ApiProperty({ example: 1500, description: 'Standard commission, basis points.' }) commissionBps!: number;
  @ApiProperty({ example: 1500, description: '0 when VAT is switched off.' }) vatBps!: number;
  @ApiProperty({ example: 0 }) serviceFeeBps!: number;
  @ApiProperty({ example: '/api/v1/admin/pricing', description: 'Where these are changed.' }) editAt!: string;
}

export class GeneralSettingsResponse {
  @ApiProperty({ example: 7, description: 'Days after Settlement that a payout is due.' }) payoutDelayDays!: number;
  @ApiProperty({ example: '+251966554411' }) supportPhone!: string;
  @ApiProperty({ type: [String], example: ['09:00', '10:00', '14:00', '16:00'] }) returnSlotTimes!: string[];
  @ApiProperty({ type: [String], example: ['Pack all included items and accessories.'] })
  returnInstructions!: string[];
  @ApiProperty({ type: CompanyDetailsResponse, description: 'Printed at the top of every invoice.' })
  company!: CompanyDetailsResponse;
  @ApiProperty({ type: PricingSummaryResponse, description: 'Read-only here.' }) pricing!: PricingSummaryResponse;
}

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AdminAuditService,
  ) {}

  async accounts(): Promise<OperatingAccountResponse[]> {
    const rows = await this.prisma.collectionAccount.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const used = await this.prisma.payment.groupBy({
      by: ['collectionAccountId'],
      where: { collectionAccountId: { in: rows.map((r) => r.id) } },
      _count: true,
    });
    const counts = new Map(used.map((u) => [u.collectionAccountId, u._count]));
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      provider: r.provider,
      accountName: r.accountName,
      accountNumber: r.accountNumber,
      merchantId: r.merchantId,
      isActive: r.isActive,
      sortOrder: r.sortOrder,
      payments: counts.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /** Add Account. The first one of the table takes over from the legacy setting. */
  async addAccount(adminId: string, dto: OperatingAccountDto): Promise<OperatingAccountResponse[]> {
    const last = await this.prisma.collectionAccount.aggregate({ _max: { sortOrder: true } });
    const created = await this.prisma.collectionAccount.create({
      data: { ...dto, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    await this.audit.record(
      adminId,
      'settings.account.create',
      'CollectionAccount',
      created.id,
      undefined,
      dto,
    );
    return this.accounts();
  }

  async updateAccount(
    adminId: string,
    id: string,
    dto: UpdateOperatingAccountDto,
  ): Promise<OperatingAccountResponse[]> {
    const before = await this.prisma.collectionAccount.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Account not found');
    await this.prisma.collectionAccount.update({ where: { id }, data: dto });
    await this.audit.record(
      adminId,
      'settings.account.update',
      'CollectionAccount',
      id,
      before,
      dto,
    );
    return this.accounts();
  }

  /** Removes an account; one customers have already paid into is only deactivated. */
  async removeAccount(adminId: string, id: string): Promise<OperatingAccountResponse[]> {
    const used = await this.prisma.payment.count({ where: { collectionAccountId: id } });
    if (used > 0) {
      await this.prisma.collectionAccount.update({ where: { id }, data: { isActive: false } });
    } else {
      await this.prisma.collectionAccount.delete({ where: { id } }).catch(() => {
        throw new NotFoundException('Account not found');
      });
    }
    await this.audit.record(
      adminId,
      used > 0 ? 'settings.account.deactivate' : 'settings.account.delete',
      'CollectionAccount',
      id,
    );
    return this.accounts();
  }

  async orderAccounts(adminId: string, ids: string[]): Promise<OperatingAccountResponse[]> {
    const known = await this.prisma.collectionAccount.count({ where: { id: { in: ids } } });
    if (known !== ids.length) throw new BadRequestException('Some ids are not operating accounts');
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.collectionAccount.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    await this.audit.record(
      adminId,
      'settings.account.order',
      'CollectionAccount',
      'all',
      undefined,
      { ids },
    );
    return this.accounts();
  }

  async general(): Promise<GeneralSettingsResponse> {
    const [
      payoutDelayDays,
      supportPhone,
      returnSlotTimes,
      returnInstructions,
      company,
      commissionBps,
      vatBps,
      serviceFeeBps,
    ] = await Promise.all([
      this.settings.payoutDelayDays(),
      this.settings.supportPhone(),
      this.settings.returnSlotTimes(),
      this.settings.returnInstructions(),
      this.settings.company(),
      this.settings.commissionBps(),
      this.settings.vatBps(),
      this.settings.serviceFeeBps(),
    ]);
    return {
      payoutDelayDays,
      supportPhone,
      returnSlotTimes,
      returnInstructions,
      company,
      pricing: { commissionBps, vatBps, serviceFeeBps, editAt: '/api/v1/admin/pricing' },
    };
  }

  async updateGeneral(adminId: string, dto: GeneralSettingsDto): Promise<GeneralSettingsResponse> {
    const before = await this.general();
    const writes: [string, Prisma.InputJsonValue][] = [];
    if (dto.payoutDelayDays !== undefined)
      writes.push([SETTING_KEYS.payoutDelayDays, dto.payoutDelayDays]);
    if (dto.supportPhone !== undefined) writes.push([SETTING_KEYS.supportPhone, dto.supportPhone]);
    if (dto.returnSlotTimes !== undefined)
      writes.push([SETTING_KEYS.returnSlotTimes, dto.returnSlotTimes]);
    if (dto.returnInstructions !== undefined)
      writes.push([SETTING_KEYS.returnInstructions, dto.returnInstructions]);
    if (dto.company !== undefined) {
      // Merge, so changing the phone does not wipe the TIN.
      const current = await this.prisma.platformSetting.findUnique({
        where: { key: SETTING_KEYS.company },
      });
      const merged = {
        ...((current?.value as Record<string, unknown> | null) ?? {}),
        ...dto.company,
      };
      writes.push([SETTING_KEYS.company, merged as Prisma.InputJsonValue]);
    }
    if (writes.length === 0) throw new BadRequestException('Nothing to change');
    await this.prisma.$transaction(
      writes.map(([key, value]) =>
        this.prisma.platformSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
    this.settings.invalidate();
    await this.audit.record(
      adminId,
      'settings.general.update',
      'PlatformSetting',
      'general',
      before,
      dto,
    );
    return this.general();
  }
}

@ApiTags('admin · settings')
@AdminAccess()
@Controller({ path: 'admin/settings', version: '1' })
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get('operating-accounts')
  @ApiOperation({
    summary: 'Eskista Operating Accounts',
    description:
      'Where customers pay — Telebirr merchant, CBE, Awash… Shown, active ones in order, on every payment screen.',
  })
  @ApiOkResponse({ type: [OperatingAccountResponse] })
  @ApiStandardErrors()
  accounts(): Promise<OperatingAccountResponse[]> {
    return this.settings.accounts();
  }

  @Post('operating-accounts')
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({ summary: 'Add Account', description: 'Added at the end of the order. Returns every account.' })
  @ApiOkResponse({ type: [OperatingAccountResponse] })
  @ApiStandardErrors({ badRequest: 'A field is invalid — e.g. the account number is not digits.' })
  add(
    @CurrentUser('id') adminId: string,
    @Body() dto: OperatingAccountDto,
  ): Promise<OperatingAccountResponse[]> {
    return this.settings.addAccount(adminId, dto);
  }

  @Patch('operating-accounts/:id')
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({ summary: 'Edit an account, or hide it (`isActive: false`)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The operating account id.' })
  @ApiOkResponse({ type: [OperatingAccountResponse] })
  @ApiStandardErrors({ badRequest: 'A field is invalid.', notFound: 'Account not found' })
  update(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOperatingAccountDto,
  ): Promise<OperatingAccountResponse[]> {
    return this.settings.updateAccount(adminId, id, dto);
  }

  @Delete('operating-accounts/:id')
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({ summary: 'Remove — or deactivate, if customers have paid into it' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The operating account id.' })
  @ApiOkResponse({ type: [OperatingAccountResponse] })
  @ApiStandardErrors({ notFound: 'Account not found' })
  remove(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OperatingAccountResponse[]> {
    return this.settings.removeAccount(adminId, id);
  }

  @Put('operating-accounts/order')
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({ summary: 'The order accounts are shown in' })
  @ApiOkResponse({ type: [OperatingAccountResponse] })
  @ApiStandardErrors({ badRequest: 'Some ids are not operating accounts' })
  order(@CurrentUser('id') adminId: string, @Body() dto: OrderDto): Promise<OperatingAccountResponse[]> {
    return this.settings.orderAccounts(adminId, dto.ids);
  }

  @Get('general')
  @ApiOperation({
    summary: 'System Settings — payout delay, support phone, returns, company details',
    description: 'Pricing (commission, VAT, fees) is shown here and edited at `/admin/pricing`.',
  })
  @ApiOkResponse({ type: GeneralSettingsResponse })
  @ApiStandardErrors()
  general(): Promise<GeneralSettingsResponse> {
    return this.settings.general();
  }

  @Patch('general')
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Change System Settings',
    description: 'Send only what changes; company details are merged into what is there.',
  })
  @ApiOkResponse({ type: GeneralSettingsResponse })
  @ApiStandardErrors({ badRequest: 'Nothing to change' })
  updateGeneral(
    @CurrentUser('id') adminId: string,
    @Body() dto: GeneralSettingsDto,
  ): Promise<GeneralSettingsResponse> {
    return this.settings.updateGeneral(adminId, dto);
  }
}
