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
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors } from '../../../common/dto/api-docs';
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

const SIGN_IN = `
Admins sign in to the dashboard with email and password through Better Auth:
\`POST /api/auth/sign-in/email\` \`{ email, password }\`, then send the session cookie (or
the bearer token) on every request. \`POST /api/auth/sign-out\` ends the session, and
\`POST /api/auth/change-password\` changes one's own password. There is no sign-up: a Super
Admin creates every admin here.
`.trim();

@ApiTags('admin · team')
@AdminAccess()
@Controller({ path: 'admin', version: '1' })
export class AdminTeamController {
  constructor(private readonly team: AdminTeamService) {}

  @Get('me')
  @ApiOperation({
    summary: 'The signed-in admin',
    description: `The header ("Abel · Super Admin"), the Overview greeting, and what this tier may do.\n\n${SIGN_IN}`,
  })
  @ApiOkResponse({ type: AdminMeResponse })
  @ApiStandardErrors()
  me(@CurrentUser('id') adminId: string): Promise<AdminMeResponse> {
    return this.team.me(adminId);
  }

  @Get('team')
  @ApiOperation({ summary: 'Admin Users & Access Control — the staff list' })
  @ApiOkResponse({ type: [AdminMemberResponse] })
  @ApiStandardErrors()
  list(@Query() query: AdminTeamQuery): Promise<AdminMemberResponse[]> {
    return this.team.list(query);
  }

  @Get('team/:id')
  @ApiOperation({ summary: 'Admin Detail' })
  @ApiParam(ID)
  @ApiOkResponse({ type: AdminMemberResponse })
  @ApiStandardErrors({ notFound: 'Admin not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminMemberResponse> {
    return this.team.get(id);
  }

  @Post('team')
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create Admin',
    description: 'Name, email, phone, password and role tier. The new admin signs in with them.',
  })
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
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Edit an admin — name, email, phone, title, role tier',
    description:
      'Send only what changes. Nobody changes their own tier; the last Super Admin cannot be demoted.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Reset Password',
    description: 'Sets a new password and signs the admin out of every session.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({ summary: 'Suspend Admin — blocks sign-in and ends their sessions' })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({ summary: 'Lift a suspension' })
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
