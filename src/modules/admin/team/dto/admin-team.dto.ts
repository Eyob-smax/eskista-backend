import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminTier } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MAX_ADMIN_PASSWORD, MIN_ADMIN_PASSWORD } from '../admin-credentials';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const PHONE = /^\+?[0-9 ()-]{7,20}$/;

export class CreateAdminDto {
  @ApiProperty({ example: 'Abel Tesfaye' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiProperty({ example: 'abel@eskista.et' })
  @IsEmail()
  @MaxLength(200)
  @Transform(trim)
  email!: string;

  @ApiPropertyOptional({ example: '+251911223344' })
  @IsOptional()
  @Matches(PHONE, { message: 'phone must be a phone number' })
  @Transform(trim)
  phone?: string;

  @ApiProperty({
    minLength: MIN_ADMIN_PASSWORD,
    maxLength: MAX_ADMIN_PASSWORD,
    example: 'correct-horse-battery',
    description: 'Their first password. They can change it with POST /api/auth/change-password.',
  })
  @IsString()
  @MinLength(MIN_ADMIN_PASSWORD)
  @MaxLength(MAX_ADMIN_PASSWORD)
  password!: string;

  @ApiProperty({ enum: AdminTier, example: AdminTier.ADMIN })
  @IsEnum(AdminTier)
  tier!: AdminTier;

  @ApiPropertyOptional({ example: 'Operations Lead' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  title?: string;
}

export class UpdateAdminDto {
  @ApiPropertyOptional({ example: 'Abel Tesfaye' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  name?: string;

  @ApiPropertyOptional({ example: 'abel@eskista.et' })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  @Transform(trim)
  email?: string;

  @ApiPropertyOptional({ example: '+251911223344' })
  @IsOptional()
  @Matches(PHONE, { message: 'phone must be a phone number' })
  @Transform(trim)
  phone?: string;

  @ApiPropertyOptional({ enum: AdminTier, example: AdminTier.FINANCE })
  @IsOptional()
  @IsEnum(AdminTier)
  tier?: AdminTier;

  @ApiPropertyOptional({ example: 'Finance Officer' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  title?: string;
}

export class ResetAdminPasswordDto {
  @ApiProperty({
    minLength: MIN_ADMIN_PASSWORD,
    description: 'The new password. The admin is signed out of every session.',
    example: 'new-strong-passphrase',
  })
  @IsString()
  @MinLength(MIN_ADMIN_PASSWORD)
  @MaxLength(MAX_ADMIN_PASSWORD)
  password!: string;
}

export class SuspendDto {
  @ApiProperty({ example: 'Left the company' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class AdminTeamQuery {
  @ApiPropertyOptional({ description: 'Name, email or phone.', example: 'Hanna Girma' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @ApiPropertyOptional({ enum: AdminTier, example: AdminTier.ADMIN })
  @IsOptional()
  @IsEnum(AdminTier)
  tier?: AdminTier;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'], example: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}

export class AdminMemberResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Abel Tesfaye' }) name!: string;
  @ApiProperty({ example: 'abel@eskista.et' }) email!: string;
  @ApiPropertyOptional({ nullable: true, example: '+251911000001' }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) avatarUrl!: string | null;
  @ApiProperty({ enum: AdminTier, example: AdminTier.SUPER_ADMIN }) tier!: AdminTier;
  @ApiProperty({ example: 'Super Admin' }) tierLabel!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Operations Lead' }) title!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'], example: 'ACTIVE' }) status!:
    'ACTIVE' | 'SUSPENDED';
  @ApiPropertyOptional({ nullable: true, example: null }) suspendedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) suspendedReason!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '2026-09-28T09:35:00.000Z',
    description: 'Last active session.',
  })
  lastActiveAt!: string | null;
  @ApiProperty({ example: 1, description: 'Sessions currently signed in.' })
  activeSessions!: number;
  @ApiPropertyOptional({ nullable: true, example: 'Abel Tesfaye' }) createdByName!: string | null;
  @ApiProperty({ example: '2026-09-01T08:00:00.000Z' }) createdAt!: string;
}

export class AdminMeResponse extends AdminMemberResponse {
  @ApiProperty({ example: 'Good Morning, Abel' }) greeting!: string;
  @ApiProperty({
    type: [String],
    description:
      'What this tier may do, for hiding buttons: team, settings, finance, operations, support.',
    example: ['team', 'settings', 'finance', 'operations', 'support'],
  })
  permissions!: string[];
}
