import { ApiEndpoint, ApiStandardErrors } from '../../common/dto/api-docs';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
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

@ApiTags('admin · pricing')
@AdminAccess()
@Controller({ path: 'admin/pricing', version: '1' })
export class AdminPricingController {
  constructor(private readonly pricing: AdminPricingService) {}

  @Get()
  @ApiEndpoint({
    summary: 'Current pricing settings',
    does: 'The platform-wide defaults: commission, service fee and delivery fee basis points, VAT, and the pricing model explanation.',
    behind: [
      'Read only. These defaults pre-fill new listing reviews and talent approvals; changing them never reprices an existing booking.',
    ],
  })
  @ApiOkResponse({ type: PricingSettingsResponse })
  getSettings(): Promise<PricingSettingsResponse> {
    return this.pricing.getSettings();
  }

  @Patch()
  @ApiEndpoint({
    summary: 'Change the default commission, service fee or delivery fee',
    does: 'Send only what changes. The new defaults apply to future reviews — existing bookings keep their frozen rates.',
    behind: [
      'Settings updated in the key-value table; in-memory cache invalidated.',
      'Admin audit log written (before and after, with optional reason).',
    ],
    rules: ['Super Admins only.'],
  })
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiOkResponse({ type: PricingSettingsResponse })
  @ApiStandardErrors({ badRequest: 'A rate is out of range.' })
  updateSettings(
    @CurrentUser('id') adminId: string,
    @Body() dto: UpdatePricingSettingsDto,
  ): Promise<PricingSettingsResponse> {
    return this.pricing.updateSettings(adminId, dto);
  }

  @Patch('listings/:id/commission')
  @ApiEndpoint({
    summary: 'Set the commission on one listing',
    does: "The most specific level — typically set when approving the listing. `null` removes the override so the vendor's rate, or the platform default, applies again.",
    behind: [
      'Commission stored on the listing; customer prices recomputed from the new rate.',
      'Admin audit log written.',
    ],
    rules: ['Super Admins only.', '404 when not found.'],
  })
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommissionResponse })
  @ApiStandardErrors({
    badRequest: '`commissionBps` must be between 0 and 10000, or null.',
    notFound: 'Listing not found',
  })
  setListing(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCommissionDto,
  ): Promise<CommissionResponse> {
    return this.pricing.setListingCommission(adminId, id, dto);
  }

  @Patch('vendors/:id/commission')
  @ApiEndpoint({
    summary: "Set the commission on all of a vendor's listings",
    does: 'Applies wherever a listing has no override of its own. `null` removes it.',
    behind: [
      'Commission stored on the vendor profile; customer prices recomputed for every listing that inherits from the vendor.',
      'Admin audit log written.',
    ],
    rules: ['Super Admins only.', '404 when not found.'],
  })
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommissionResponse })
  @ApiStandardErrors({
    badRequest: '`commissionBps` must be between 0 and 10000, or null.',
    notFound: 'Vendor not found',
  })
  setVendor(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCommissionDto,
  ): Promise<CommissionResponse> {
    return this.pricing.setVendorCommission(adminId, id, dto);
  }

  @Patch('talent/:id/commission')
  @ApiEndpoint({
    summary: 'Set the commission on a talent',
    does: "Typically set when approving the talent's profile. `null` falls back to the default.",
    behind: [
      'Commission stored on the talent profile; customer prices recomputed for every service.',
      'Admin audit log written.',
    ],
    rules: ['Super Admins only.', '404 when not found.'],
  })
  @AdminAccess(AdminTier.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommissionResponse })
  @ApiStandardErrors({
    badRequest: '`commissionBps` must be between 0 and 10000, or null.',
    notFound: 'Talent not found',
  })
  setTalent(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCommissionDto,
  ): Promise<CommissionResponse> {
    return this.pricing.setTalentCommission(adminId, id, dto);
  }
}
