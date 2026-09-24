import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth.decorators';
import { AccountService } from './account.service';
import { MeResponse, SwitchRoleDto } from './dto/account.dto';

@ApiTags('account')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'No valid session.' })
@Controller({ path: 'me', version: '1' })
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  @ApiOperation({
    summary: 'Who am I, and which experience am I in',
    description: `
Call this right after sign-in to decide which app to open.

- \`needsExperienceChoice: true\` — show the **"How will you use Eskista?"** chooser. It is
  shown once; after that, switching lives on the Profile tab.
- Otherwise open the experience in \`activeRole\`.

\`experiences\` gives each option on the chooser with its state. \`granted: false\` means the
user must onboard first — \`onboardingEndpoint\` says where.

\`roles\` is what the user is *authorised* to do. \`activeRole\` is only which experience is
showing; switching it never changes authority.
`.trim(),
  })
  @ApiOkResponse({ type: MeResponse })
  me(@CurrentUser('id') userId: string): Promise<MeResponse> {
    return this.account.me(userId);
  }

  @Patch('active-role')
  @ApiOperation({
    summary: 'Switch experience',
    description: `
Backs the chooser and the "switch anytime from your profile" option.

Switches only to a role the user already holds. Becoming a vendor or talent is onboarding,
not a switch — that returns **409** with the onboarding endpoint to use. \`CUSTOMER\` needs
no onboarding and is always allowed.

The first call also records that the chooser has been answered, so it is not shown again.
`.trim(),
  })
  @ApiOkResponse({ type: MeResponse, description: 'The refreshed account.' })
  @ApiConflictResponse({ description: 'That role is not held yet — onboard first.' })
  switchRole(@CurrentUser('id') userId: string, @Body() dto: SwitchRoleDto): Promise<MeResponse> {
    return this.account.switchRole(userId, dto.role);
  }
}
