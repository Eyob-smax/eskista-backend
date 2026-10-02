import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors, ApiEndpoint } from '../../../common/dto/api-docs';
import { AdminTier } from '@prisma/client';
import { CurrentUser } from '../../auth/auth.decorators';
import { AdminAccess } from '../core/admin-access';
import { AdminTeamService } from './admin-team.service';
import {
  AdminMeResponse,
  AdminMemberResponse,
  AdminTeamQuery,
  CreateAdminDto,
  ResetAdminPasswordDto,
  SuspendDto,
  UpdateAdminDto,
} from './dto/admin-team.dto';

const ID = { name: 'id', format: 'uuid', description: 'The admin’s user id.' };

@ApiTags('admin · team')
@AdminAccess()
@Controller({ path: 'admin', version: '1' })
export class AdminTeamController {
  constructor(private readonly team: AdminTeamService) {}

  @Get('me')
  @ApiEndpoint({
    summary: 'The signed-in admin',
    does: 'Who is signed in: name, tier, greeting, and `permissions` for hiding what this tier cannot use.',
    behind: ['Read only. Every admin request refreshes "last active" at most every 5 minutes.'],
    notes: 'Sign in at `POST /api/auth/sign-in/email`; see **admin · auth**.',
  })
  @ApiOkResponse({ type: AdminMeResponse })
  @ApiStandardErrors()
  me(@CurrentUser('id') adminId: string): Promise<AdminMeResponse> {
    return this.team.me(adminId);
  }

  @Get('team')
  @ApiEndpoint({
    summary: 'Admin Users & Access Control — the staff list',
    does: 'Every admin, with tier, status and last active session.',
    behind: [
      'Read only. Last active is the later of the admin guard’s touch and the newest session refresh.',
    ],
  })
  @ApiOkResponse({ type: [AdminMemberResponse] })
  @ApiStandardErrors()
  list(@Query() query: AdminTeamQuery): Promise<AdminMemberResponse[]> {
    return this.team.list(query);
  }

  @Get('team/:id')
  @ApiEndpoint({
    summary: 'Admin Detail',
    does: 'One admin.',
    behind: ['Read only.'],
    rules: ['404 when the id is not an admin.'],
  })
  @ApiParam(ID)
  @ApiOkResponse({ type: AdminMemberResponse })
  @ApiStandardErrors({ notFound: 'Admin not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminMemberResponse> {
    return this.team.get(id);
  }

  @Post('team')
  @ApiEndpoint({
    summary: 'Create Admin',
    does: 'Adds a member of staff who signs in with email and password.',
    behind: [
      'User created with the ADMIN role and a profile holding the tier, phone and title.',
      'Password hashed exactly as Better Auth hashes it (scrypt) and stored on a credential account — sign-up is disabled, so this is the only way an admin account comes to exist.',
      'Admin audit log written.',
    ],
    rules: [
      'Super Admins only.',
      '409 when the email is already in use.',
      '400 when the password is under 12 characters.',
    ],
  })
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOkResponse({ type: AdminMemberResponse })
  @ApiStandardErrors({
    badRequest: 'A field is invalid — e.g. the password is shorter than 12 characters.',
    conflict: 'An account with this email already exists',
  })
  create(
    @CurrentUser('id') actorId: string,
    @Body() dto: CreateAdminDto,
  ): Promise<AdminMemberResponse> {
    return this.team.create(actorId, dto);
  }

  @Patch('team/:id')
  @ApiEndpoint({
    summary: 'Edit an admin',
    does: 'Changes name, email, phone, title or role tier. Send only what changes.',
    behind: ['User and admin profile updated; admin audit log written (before and after).'],
    rules: [
      'Super Admins only.',
      '400 when changing your own tier.',
      '409 when demoting the last active Super Admin, or the email is taken.',
    ],
  })
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiParam(ID)
  @ApiOkResponse({ type: AdminMemberResponse })
  @ApiStandardErrors({
    badRequest: 'You cannot change your own role tier',
    notFound: 'Admin not found',
    conflict: 'This is the last active Super Admin; appoint another first',
  })
  update(
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminDto,
  ): Promise<AdminMemberResponse> {
    return this.team.update(actorId, id, dto);
  }

  @Post('team/:id/reset-password')
  @ApiEndpoint({
    summary: 'Reset Password',
    does: 'Sets a new password for an admin.',
    behind: [
      'Password re-hashed onto the credential account.',
      'Every session of that admin deleted: they are signed out everywhere.',
      'Admin audit log written.',
    ],
    rules: ['Super Admins only.', '400 when under 12 characters.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiParam(ID)
  @ApiOkResponse({ type: AdminMemberResponse })
  @ApiStandardErrors({
    badRequest: 'The password is shorter than 12 characters.',
    notFound: 'Admin not found',
  })
  resetPassword(
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetAdminPasswordDto,
  ): Promise<AdminMemberResponse> {
    return this.team.resetPassword(actorId, id, dto);
  }

  @Post('team/:id/suspend')
  @ApiEndpoint({
    summary: 'Suspend Admin',
    does: 'Blocks an admin from signing in, with a reason.',
    behind: [
      'Account blocked (the session guard refuses blocked accounts on every route) and every session deleted, so it takes effect at once.',
      'Admin audit log written.',
    ],
    rules: [
      'Super Admins only.',
      '400 when suspending yourself.',
      '409 for the last active Super Admin.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiParam(ID)
  @ApiOkResponse({ type: AdminMemberResponse })
  @ApiStandardErrors({
    badRequest: 'You cannot suspend yourself',
    notFound: 'Admin not found',
    conflict: 'This is the last active Super Admin; appoint another first',
  })
  suspend(
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendDto,
  ): Promise<AdminMemberResponse> {
    return this.team.suspend(actorId, id, dto.reason);
  }

  @Post('team/:id/reactivate')
  @ApiEndpoint({
    summary: 'Lift a suspension',
    does: 'Lets a suspended admin sign in again.',
    behind: ['Block cleared; admin audit log written. They sign in afresh.'],
    rules: ['Super Admins only.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiParam(ID)
  @ApiOkResponse({ type: AdminMemberResponse })
  @ApiStandardErrors({ notFound: 'Admin not found' })
  reactivate(
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminMemberResponse> {
    return this.team.reactivate(actorId, id);
  }
}
