import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { AdminTier } from '@prisma/client';
import type { Response } from 'express';
import { ApiPaginatedResponse, ApiStandardErrors, ApiEndpoint } from '../../../common/dto/api-docs';
import type { Paginated } from '../../../common/dto/pagination.dto';
import { CurrentUser } from '../../auth/auth.decorators';
import { AdminAccess } from '../core/admin-access';
import { CSV_CONTENT, sendCsv } from '../core/admin-http';
import {
  AccountReasonDto,
  AdminCustomersQuery,
  AdminVendorsQuery,
  CustomerDetailResponse,
  CustomerRowResponse,
  VendorDetailResponse,
  VendorRowResponse,
  VerifyVendorDto,
} from './admin-users.dto';
import { AdminCustomersService } from './admin-customers.service';
import { AdminVendorsService } from './admin-vendors.service';

const VENDOR_ID = { name: 'id', format: 'uuid', description: 'The vendor profile id.' };
const CUSTOMER_ID = { name: 'id', format: 'uuid', description: 'The customer’s user id.' };

@ApiTags('admin · vendors')
@AdminAccess()
@Controller({ path: 'admin/vendors', version: '1' })
export class AdminVendorsController {
  constructor(private readonly vendors: AdminVendorsService) {}

  @Get()
  @ApiEndpoint({
    summary: 'Vendor Accounts',
    does: 'Every vendor, newest first. Search by business name, representative, phone or email.',
    behind: ['Read only.'],
  })
  @ApiPaginatedResponse(VendorRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminVendorsQuery): Promise<Paginated<VendorRowResponse>> {
    return this.vendors.list(query);
  }

  @Get('export')
  @ApiEndpoint({
    summary: 'Export (CSV)',
    does: 'The table as a CSV file, with lifetime earnings.',
    behind: ['Read only. Up to 10,000 vendors; amounts in ETB with two decimals.'],
  })
  @ApiOkResponse({ description: 'A CSV file, one row per vendor.', content: CSV_CONTENT })
  @ApiStandardErrors()
  async export(
    @Query() query: AdminVendorsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendCsv(res, await this.vendors.exportCsv(query), 'eskista-vendors');
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Vendor detail',
    does: 'Rating, lifetime earnings, pending escrow settlement, the representative, payout accounts (primary and alternative), documents, the vendor agreement, recent bookings, and what blocks verification.',
    behind: ['Read only.'],
    rules: ['404 when not found.'],
  })
  @ApiParam(VENDOR_ID)
  @ApiOkResponse({ type: VendorDetailResponse })
  @ApiStandardErrors({ notFound: 'Vendor not found' })
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<VendorDetailResponse> {
    return this.vendors.detail(id);
  }

  @Post(':id/verify')
  @ApiEndpoint({
    summary: 'Verify vendor',
    does: "Accepts the pending documents and the uploaded vendor agreement scan. The vendor's approved equipment becomes visible on the catalogue.",
    behind: [
      'Vendor status → VERIFIED; documents accepted.',
      'Notification: vendor — Your Account Is Verified.',
      'Admin audit log written.',
    ],
    seenBy: ['Vendor: they can now manage inventory, receive bookings and get paid.'],
    rules: [
      '404 when not found.',
      '409 when the vendor cannot be verified yet (`blockers` lists why).',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(VENDOR_ID)
  @ApiOkResponse({ type: VendorDetailResponse })
  @ApiStandardErrors({
    notFound: 'Vendor not found',
    conflict: 'This vendor cannot be verified yet (`blockers` lists why)',
  })
  verify(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyVendorDto,
  ): Promise<VendorDetailResponse> {
    return this.vendors.verify(adminId, id, dto);
  }

  @Post(':id/reject')
  @ApiEndpoint({
    summary: 'Reject verification',
    does: 'The reason goes to the vendor, who can fix and resubmit.',
    behind: [
      'Vendor status back to previous; notification sent with the reason.',
      'Admin audit log written.',
    ],
    seenBy: ['Vendor: "Your account needs attention" with the reason.'],
    rules: [
      '400 when `reason` is missing or too short.',
      '404 when not found.',
      '409 when only a vendor awaiting verification can be rejected.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(VENDOR_ID)
  @ApiOkResponse({ type: VendorDetailResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: 'Vendor not found',
    conflict: 'Only a vendor awaiting verification can be rejected',
  })
  reject(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ): Promise<VendorDetailResponse> {
    return this.vendors.reject(adminId, id, dto.reason);
  }

  @Post(':id/suspend')
  @ApiEndpoint({
    summary: 'Suspend vendor',
    does: 'Their equipment leaves the catalogue at once; rentals already under way go on.',
    behind: [
      'Vendor status → SUSPENDED; every published listing hidden from search.',
      'Notification: vendor — Account Suspended (with the reason).',
      'The vendor can still sign in and manage existing bookings. To block sign-in entirely, use Suspend User on `/admin/customers`.',
      'Admin audit log written.',
    ],
    rules: ['400 when `reason` is missing.', '404 when not found.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(VENDOR_ID)
  @ApiOkResponse({ type: VendorDetailResponse })
  @ApiStandardErrors({ badRequest: '`reason` missing.', notFound: 'Vendor not found' })
  suspend(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ): Promise<VendorDetailResponse> {
    return this.vendors.suspend(adminId, id, dto.reason);
  }

  @Post(':id/reactivate')
  @ApiEndpoint({
    summary: 'Lift the suspension — back to verified, or to review if never verified',
    does: 'Restores a suspended vendor; their equipment becomes searchable again.',
    behind: ['Vendor status restored; listings republished.', 'Admin audit log written.'],
    rules: ['404 when not found.', '409 when this vendor is not suspended.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(VENDOR_ID)
  @ApiOkResponse({ type: VendorDetailResponse })
  @ApiStandardErrors({ notFound: 'Vendor not found', conflict: 'This vendor is not suspended' })
  reactivate(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VendorDetailResponse> {
    return this.vendors.reactivate(adminId, id);
  }
}

@ApiTags('admin · customers')
@AdminAccess()
@Controller({ path: 'admin/customers', version: '1' })
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @Get()
  @ApiEndpoint({
    summary: 'Customer Accounts',
    does: 'Everyone who books, companies and individuals. Admins are left out.',
    behind: ['Read only.'],
  })
  @ApiPaginatedResponse(CustomerRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminCustomersQuery): Promise<Paginated<CustomerRowResponse>> {
    return this.customers.list(query);
  }

  @Get('export')
  @ApiEndpoint({
    summary: 'Export (CSV)',
    does: 'The table as a CSV file, with total spend.',
    behind: ['Read only. Up to 10,000 customers.'],
  })
  @ApiOkResponse({ description: 'A CSV file, one row per customer.', content: CSV_CONTENT })
  @ApiStandardErrors()
  async export(
    @Query() query: AdminCustomersQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendCsv(res, await this.customers.exportCsv(query), 'eskista-customers');
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Customer detail',
    does: 'The representative, the verification document, open bookings (Open Booking File), recent ones, spend.',
    behind: ['Read only.'],
    rules: ['404 when not found.'],
  })
  @ApiParam(CUSTOMER_ID)
  @ApiOkResponse({ type: CustomerDetailResponse })
  @ApiStandardErrors({ notFound: 'Customer not found' })
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerDetailResponse> {
    return this.customers.detail(id);
  }

  @Post(':id/verify')
  @ApiEndpoint({
    summary: 'Grant the Verified customer badge',
    does: 'From their uploaded business document. Never needed to book — it is a trust badge.',
    behind: ['Customer profile status → VERIFIED. Admin audit log written.'],
    rules: [
      '404 when this customer has no profile yet.',
      '409 when the customer has not uploaded a document.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(CUSTOMER_ID)
  @ApiOkResponse({ type: CustomerDetailResponse })
  @ApiStandardErrors({
    notFound: 'This customer has no profile yet',
    conflict: 'The customer has not uploaded a document',
  })
  verify(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerDetailResponse> {
    return this.customers.verify(adminId, id);
  }

  @Post(':id/reject-verification')
  @ApiEndpoint({
    summary: 'Refuse the badge — the document does not check out',
    does: 'Rejects the uploaded document with a reason.',
    behind: [
      'Customer profile document status → REJECTED; the customer is told why.',
      'Admin audit log written.',
    ],
    rules: [
      '400 when `reason` is missing or too short.',
      '404 when this customer has no profile yet.',
    ],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiParam(CUSTOMER_ID)
  @ApiOkResponse({ type: CustomerDetailResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing or too short.',
    notFound: 'This customer has no profile yet',
  })
  rejectVerification(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ): Promise<CustomerDetailResponse> {
    return this.customers.rejectVerification(adminId, id, dto.reason);
  }

  @Post(':id/suspend')
  @ApiEndpoint({
    summary: 'Suspend User',
    does: 'Blocks sign-in to every part of Eskista — customer, vendor and talent alike — and ends their sessions.',
    behind: [
      'Account blocked (the session guard refuses blocked accounts on every route).',
      'Every session of that user deleted — it takes effect at once.',
      'Admin audit log written.',
    ],
    rules: [
      '400 when `reason` is missing.',
      '404 when not found.',
      '409 when this is an admin account.',
    ],
    notes: 'Admin accounts are suspended from the admin team screen instead.',
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.SUPPORT)
  @ApiParam(CUSTOMER_ID)
  @ApiOkResponse({ type: CustomerDetailResponse })
  @ApiStandardErrors({
    badRequest: '`reason` missing.',
    notFound: 'Customer not found',
    conflict: 'Admins are suspended from the admin team screen',
  })
  suspend(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ): Promise<CustomerDetailResponse> {
    return this.customers.suspend(adminId, id, dto.reason);
  }

  @Post(':id/reactivate')
  @ApiEndpoint({
    summary: 'Lift a Suspend User',
    does: 'Lets a suspended user sign in again.',
    behind: ['Account block cleared; they sign in afresh. Admin audit log written.'],
    rules: ['404 when not found.', '409 when this is an admin account.'],
  })
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.SUPPORT)
  @ApiParam(CUSTOMER_ID)
  @ApiOkResponse({ type: CustomerDetailResponse })
  @ApiStandardErrors({
    notFound: 'Customer not found',
    conflict: 'Admins are reactivated from the admin team screen',
  })
  reactivate(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerDetailResponse> {
    return this.customers.reactivate(adminId, id);
  }
}
