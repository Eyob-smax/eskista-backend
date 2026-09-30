import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth.decorators';
import { AdminTier } from '@prisma/client';
import { AdminAccess } from '../admin/core/admin-access';
import { AdminPricingService } from './admin-pricing.service';
import {
  CommissionResponse,
  PricingSettingsResponse,
  SetCommissionDto,
  UpdatePricingSettingsDto,
} from './dto/admin-pricing.dto';

const HOW_IT_PRICES = `
**How a price is built.** The supplier sets what they want to earn. Eskista adds commission
on top; VAT is added on top of that; the customer sees the all-in, VAT-inclusive figure.
The supplier is always paid exactly what they listed.

**Where commission comes from**, most specific first: the listing → the vendor (or the
talent) → the platform default. Changing any level moves the catalogue immediately, but
**never reprices an existing booking** — each booking froze the rate it was priced at.
`.trim();

@ApiTags('admin · pricing')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Admins only.' })
@AdminAccess()
@Controller({ path: 'admin/pricing', version: '1' })
export class AdminPricingController {
  constructor(private readonly pricing: AdminPricingService) {}

  @Get()
  @ApiOperation({ summary: 'Current pricing settings', description: HOW_IT_PRICES })
  @ApiOkResponse({ type: PricingSettingsResponse })
  getSettings(): Promise<PricingSettingsResponse> {
    return this.pricing.getSettings();
  }

  @Patch()
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Change the default commission, service fee or delivery fee',
    description: `${HOW_IT_PRICES}\n\nSend only what changes. Audited, with the optional reason.`,
  })
  @ApiOkResponse({ type: PricingSettingsResponse })
  updateSettings(
    @CurrentUser('id') adminId: string,
    @Body() dto: UpdatePricingSettingsDto,
  ): Promise<PricingSettingsResponse> {
    return this.pricing.updateSettings(adminId, dto);
  }

  @Patch('listings/:id/commission')
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Set the commission on one listing',
    description:
      'The most specific level — typically set when approving the listing. `null` removes ' +
      'the override so the vendor’s rate, or the platform default, applies again.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommissionResponse })
  @ApiNotFoundResponse({ description: 'No such listing.' })
  setListing(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCommissionDto,
  ): Promise<CommissionResponse> {
    return this.pricing.setListingCommission(adminId, id, dto);
  }

  @Patch('vendors/:id/commission')
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Set the commission on all of a vendor’s listings',
    description: 'Applies wherever a listing has no override of its own. `null` removes it.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommissionResponse })
  @ApiNotFoundResponse({ description: 'No such vendor.' })
  setVendor(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCommissionDto,
  ): Promise<CommissionResponse> {
    return this.pricing.setVendorCommission(adminId, id, dto);
  }

  @Patch('talent/:id/commission')
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Set the commission on a talent',
    description:
      'Typically set when approving the talent’s profile. `null` falls back to the default.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommissionResponse })
  @ApiNotFoundResponse({ description: 'No such talent.' })
  setTalent(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCommissionDto,
  ): Promise<CommissionResponse> {
    return this.pricing.setTalentCommission(adminId, id, dto);
  }
}
