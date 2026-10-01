import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import { AccountChannel, type PayoutAccount } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiStandardErrors } from '../../common/dto/api-docs';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** A primary and a few alternatives is what anyone needs; more is a mistake. */
export const MAX_PAYOUT_ACCOUNTS = 5;

export class PayoutAccountDto {
  @ApiProperty({ enum: AccountChannel, example: AccountChannel.TELEBIRR })
  @IsEnum(AccountChannel)
  channel!: AccountChannel;

  @ApiPropertyOptional({
    example: 'Commercial Bank of Ethiopia',
    description: 'The bank. For Telebirr it is always "Telebirr".',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Transform(trim)
  provider?: string;

  @ApiProperty({ example: 'Afro Studio PLC', description: 'The name on the account.' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  accountName!: string;

  @ApiProperty({ example: '1000123456789', description: 'Account number, or the Telebirr phone.' })
  @Matches(/^\+?[0-9 -]{6,34}$/, { message: 'accountNumber must be digits' })
  @Transform(trim)
  accountNumber!: string;

  @ApiPropertyOptional({ description: 'Make this the account payouts go to.' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdatePayoutAccountDto extends PartialType(PayoutAccountDto) {}

export class PayoutAccountResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: AccountChannel }) channel!: AccountChannel;
  @ApiProperty({ example: 'Telebirr' }) provider!: string;
  @ApiProperty() accountName!: string;
  @ApiProperty() accountNumber!: string;
  @ApiProperty({ example: '•••• 6789', description: 'For lists.' }) maskedNumber!: string;
  @ApiProperty() isPrimary!: boolean;
  @ApiProperty() createdAt!: string;
}

type Owner = { vendorId: string } | { talentProfileId: string };

export function maskAccount(number: string): string {
  const digits = number.replace(/\D/g, '');
  return digits.length <= 4 ? digits : `•••• ${digits.slice(-4)}`;
}

export function toPayoutAccountResponse(a: PayoutAccount): PayoutAccountResponse {
  return {
    id: a.id,
    channel: a.channel,
    provider: a.provider,
    accountName: a.accountName,
    accountNumber: a.accountNumber,
    maskedNumber: maskAccount(a.accountNumber),
    isPrimary: a.isPrimary,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * Where Eskista sends a supplier's money — "Payout Method: Telebirr", with an alternative.
 * Vendors and talents manage their own; exactly one is primary whenever any exist, and a
 * settlement copies it when paid.
 */
@Injectable()
export class PayoutAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async ownerFor(userId: string, kind: 'vendor' | 'talent'): Promise<Owner> {
    if (kind === 'vendor') {
      const v = await this.prisma.vendorProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!v) throw new NotFoundException('No vendor profile for this account');
      return { vendorId: v.id };
    }
    const t = await this.prisma.talentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('No talent profile for this account');
    return { talentProfileId: t.id };
  }

  async list(owner: Owner): Promise<PayoutAccountResponse[]> {
    const rows = await this.prisma.payoutAccount.findMany({
      where: owner,
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toPayoutAccountResponse);
  }

  async create(owner: Owner, dto: PayoutAccountDto): Promise<PayoutAccountResponse[]> {
    const count = await this.prisma.payoutAccount.count({ where: owner });
    if (count >= MAX_PAYOUT_ACCOUNTS) {
      throw new ConflictException(`At most ${MAX_PAYOUT_ACCOUNTS} payout accounts`);
    }
    const primary = dto.isPrimary === true || count === 0;
    await this.prisma.$transaction(async (tx) => {
      if (primary) await tx.payoutAccount.updateMany({ where: owner, data: { isPrimary: false } });
      await tx.payoutAccount.create({
        data: {
          ...owner,
          channel: dto.channel,
          provider: this.provider(dto.channel, dto.provider),
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          isPrimary: primary,
        },
      });
    });
    return this.list(owner);
  }

  async update(
    owner: Owner,
    id: string,
    dto: UpdatePayoutAccountDto,
  ): Promise<PayoutAccountResponse[]> {
    const existing = await this.require(owner, id);
    const channel = dto.channel ?? existing.channel;
    await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true)
        await tx.payoutAccount.updateMany({ where: owner, data: { isPrimary: false } });
      await tx.payoutAccount.update({
        where: { id },
        data: {
          channel,
          provider:
            dto.provider !== undefined || dto.channel !== undefined
              ? this.provider(channel, dto.provider ?? existing.provider)
              : undefined,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          // Only ever set to true here: to change the primary, make another one primary.
          ...(dto.isPrimary === true ? { isPrimary: true } : {}),
        },
      });
    });
    return this.list(owner);
  }

  async remove(owner: Owner, id: string): Promise<PayoutAccountResponse[]> {
    const existing = await this.require(owner, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.payoutAccount.delete({ where: { id } });
      if (existing.isPrimary) {
        const next = await tx.payoutAccount.findFirst({
          where: owner,
          orderBy: { createdAt: 'asc' },
        });
        if (next)
          await tx.payoutAccount.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    });
    return this.list(owner);
  }

  private provider(channel: AccountChannel, provider: string | undefined): string {
    if (channel === AccountChannel.TELEBIRR) return 'Telebirr';
    if (!provider)
      throw new BadRequestException('provider (the bank) is required for a bank account');
    return provider;
  }

  private async require(owner: Owner, id: string): Promise<PayoutAccount> {
    const row = await this.prisma.payoutAccount.findFirst({ where: { id, ...owner } });
    if (!row) throw new NotFoundException('Payout account not found');
    return row;
  }
}

const DESCRIPTION =
  'Where Eskista sends your payouts. The primary account is used; keep an alternative in ' +
  'case it fails. The first one added becomes primary.';

@ApiTags('vendor · payout accounts')
@Roles('VENDOR')
@Controller({ path: 'vendor/payout-accounts', version: '1' })
export class VendorPayoutAccountsController {
  constructor(private readonly accounts: PayoutAccountsService) {}

  @Get()
  @ApiOperation({ summary: 'My payout accounts', description: DESCRIPTION })
  @ApiOkResponse({ type: [PayoutAccountResponse], description: 'Primary first.' })
  @ApiStandardErrors({ notFound: 'No profile for this account yet' })
  async list(@CurrentUser('id') userId: string): Promise<PayoutAccountResponse[]> {
    return this.accounts.list(await this.accounts.ownerFor(userId, 'vendor'));
  }

  @Post()
  @ApiOperation({
    summary: 'Add a payout account',
    description: 'Telebirr (provider is set for you) or a bank. `isPrimary: true` makes it the one used. Returns every account.',
  })
  @ApiOkResponse({ type: [PayoutAccountResponse] })
  @ApiStandardErrors({
    badRequest: 'provider (the bank) is required for a bank account',
    notFound: 'No profile for this account yet',
    conflict: 'At most 5 payout accounts',
  })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: PayoutAccountDto,
  ): Promise<PayoutAccountResponse[]> {
    return this.accounts.create(await this.accounts.ownerFor(userId, 'vendor'), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a payout account, or make it primary (`isPrimary: true`)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The payout account id.' })
  @ApiOkResponse({ type: [PayoutAccountResponse] })
  @ApiStandardErrors({ badRequest: 'A field is invalid.', notFound: 'Payout account not found' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayoutAccountDto,
  ): Promise<PayoutAccountResponse[]> {
    return this.accounts.update(await this.accounts.ownerFor(userId, 'vendor'), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a payout account', description: 'Removing the primary promotes the oldest remaining one.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The payout account id.' })
  @ApiOkResponse({ type: [PayoutAccountResponse] })
  @ApiStandardErrors({ notFound: 'Payout account not found' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PayoutAccountResponse[]> {
    return this.accounts.remove(await this.accounts.ownerFor(userId, 'vendor'), id);
  }
}

@ApiTags('talent · payout accounts')
@Roles('TALENT')
@Controller({ path: 'talent/payout-accounts', version: '1' })
export class TalentPayoutAccountsController {
  constructor(private readonly accounts: PayoutAccountsService) {}

  @Get()
  @ApiOperation({ summary: 'My payout accounts', description: DESCRIPTION })
  @ApiOkResponse({ type: [PayoutAccountResponse], description: 'Primary first.' })
  @ApiStandardErrors({ notFound: 'No profile for this account yet' })
  async list(@CurrentUser('id') userId: string): Promise<PayoutAccountResponse[]> {
    return this.accounts.list(await this.accounts.ownerFor(userId, 'talent'));
  }

  @Post()
  @ApiOperation({
    summary: 'Add a payout account',
    description: 'Telebirr (provider is set for you) or a bank. `isPrimary: true` makes it the one used. Returns every account.',
  })
  @ApiOkResponse({ type: [PayoutAccountResponse] })
  @ApiStandardErrors({
    badRequest: 'provider (the bank) is required for a bank account',
    notFound: 'No profile for this account yet',
    conflict: 'At most 5 payout accounts',
  })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: PayoutAccountDto,
  ): Promise<PayoutAccountResponse[]> {
    return this.accounts.create(await this.accounts.ownerFor(userId, 'talent'), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a payout account, or make it primary (`isPrimary: true`)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The payout account id.' })
  @ApiOkResponse({ type: [PayoutAccountResponse] })
  @ApiStandardErrors({ badRequest: 'A field is invalid.', notFound: 'Payout account not found' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayoutAccountDto,
  ): Promise<PayoutAccountResponse[]> {
    return this.accounts.update(await this.accounts.ownerFor(userId, 'talent'), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a payout account', description: 'Removing the primary promotes the oldest remaining one.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'The payout account id.' })
  @ApiOkResponse({ type: [PayoutAccountResponse] })
  @ApiStandardErrors({ notFound: 'Payout account not found' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PayoutAccountResponse[]> {
    return this.accounts.remove(await this.accounts.ownerFor(userId, 'talent'), id);
  }
}

@Module({
  controllers: [VendorPayoutAccountsController, TalentPayoutAccountsController],
  providers: [PayoutAccountsService],
  exports: [PayoutAccountsService],
})
export class PayoutAccountsModule {}
