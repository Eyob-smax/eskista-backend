import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
import { CurrentUser } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';

export class ClaimProfileDto {
  @ApiProperty({ example: 'K7Q2-MX9P', description: 'The code Eskista gave you.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/, { message: 'code must look like K7Q2-MX9P' })
  code!: string;
}

export class ClaimResultResponse {
  @ApiProperty({ format: 'uuid' }) talentProfileId!: string;
  @ApiProperty({ example: 'Dawit Bekele' }) displayName!: string;
  @ApiProperty({ description: 'Where to go next: VERIFIED profiles are live already.', example: 'VERIFIED' })
  status!: string;
}

/**
 * Takes over a profile Eskista registered for you ("Register New Talent"). Moves the
 * profile — and anything already attached to it, such as agreements or notifications —
 * from the stand-in account to the signed-in Telegram account, then removes the stand-in.
 */
@Injectable()
export class TalentClaimService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(userId: string, rawCode: string): Promise<ClaimResultResponse> {
    const code = rawCode.includes('-') ? rawCode : `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
    const profile = await this.prisma.talentProfile.findUnique({ where: { claimCode: code } });
    if (!profile || !profile.claimCodeExpiresAt || profile.claimCodeExpiresAt < new Date()) {
      throw new NotFoundException('That code is not valid. Ask Eskista for a new one.');
    }
    if (profile.userId === userId) {
      return {
        talentProfileId: profile.id,
        displayName: profile.displayName,
        status: profile.status,
      };
    }
    const own = await this.prisma.talentProfile.findUnique({ where: { userId } });
    if (own) throw new ConflictException('This account already has a talent profile');

    const standIn = profile.userId;
    await this.prisma.$transaction(async (tx) => {
      await tx.talentProfile.update({
        where: { id: profile.id },
        data: { userId, claimCode: null, claimCodeExpiresAt: null },
      });
      await tx.agreement.updateMany({
        where: { counterpartyId: standIn },
        data: { counterpartyId: userId },
      });
      await tx.notification.updateMany({ where: { userId: standIn }, data: { userId } });
      await tx.roleMembership.upsert({
        where: { userId_role: { userId, role: Role.TALENT } },
        create: { userId, role: Role.TALENT },
        update: {},
      });
      await tx.user.update({ where: { id: userId }, data: { activeRole: Role.TALENT } });
      // The profile has moved off it, so deleting the stand-in cascades to nothing of value.
      await tx.user.delete({ where: { id: standIn } });
    });
    return {
      talentProfileId: profile.id,
      displayName: profile.displayName,
      status: profile.status,
    };
  }
}

@ApiTags('talent · claim')
@Controller({ path: 'talent', version: '1' })
export class TalentClaimController {
  constructor(private readonly claims: TalentClaimService) {}

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  // A code is about 40 bits and takes over a profile, so guessing is throttled hard: five
  // tries a minute per client.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiEndpoint({
    summary: 'Claim a profile Eskista registered for you',
    does: 'Transfers an operator pre-registered talent profile to the signed-in user account using a one-time verification code.',
    behind: [
      'Validates claim code against unexpired TalentProfile records.',
      'Reassigns talentProfile, agreement, and notification rows to the signed-in user.',
      'Grants TALENT role and activates TALENT activeRole in a single transaction.',
      'Deletes the temporary stand-in user record.',
    ],
    seenBy: [
      'Talent onboarding: automatically unlocks the verified talent profile and dashboard.',
    ],
    rules: [
      '400 if claim code format is invalid (must look like K7Q2-MX9P).',
      '401 if unauthenticated.',
      '404 if claim code is expired or invalid.',
      '409 if the signed-in user already has a talent profile.',
    ],
  })
  @ApiOkResponse({ type: ClaimResultResponse })
  @ApiStandardErrors({
    badRequest: 'code must look like K7Q2-MX9P',
    notFound: 'That code is not valid. Ask Eskista for a new one.',
    conflict: 'This account already has a talent profile',
  })
  claim(
    @CurrentUser('id') userId: string,
    @Body() dto: ClaimProfileDto,
  ): Promise<ClaimResultResponse> {
    return this.claims.claim(userId, dto.code);
  }
}
