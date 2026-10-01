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
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AdminTier } from '@prisma/client';
import type { Response } from 'express';
import { ApiPaginatedResponse, ApiStandardErrors } from '../../../common/dto/api-docs';
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
  @ApiOperation({ summary: 'Vendor Accounts', description: 'Newest first. Search by business, representative, phone or email.' })
  @ApiPaginatedResponse(VendorRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminVendorsQuery): Promise<Paginated<VendorRowResponse>> {
    return this.vendors.list(query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export (CSV)', description: 'Same filters as the table, with lifetime earnings.' })
  @ApiOkResponse({ description: 'A CSV file, one row per vendor.', content: CSV_CONTENT })
  @ApiStandardErrors()
  async export(
    @Query() query: AdminVendorsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendCsv(res, await this.vendors.exportCsv(query), 'eskista-vendors');
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Vendor detail',
    description:
      'Rating, lifetime earnings, pending escrow settlement, the representative, payout accounts ' +
      '(primary and alternative), documents, the vendor agreement, recent bookings, and what ' +
      'blocks verification.',
  })
  @ApiParam(VENDOR_ID)
  @ApiOkResponse({ type: VendorDetailResponse })
  @ApiStandardErrors({ notFound: 'Vendor not found' })
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<VendorDetailResponse> {
    return this.vendors.detail(id);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Verify vendor',
    description:
      'Accepts the pending documents and the uploaded vendor agreement scan. The vendor’s ' +
      'approved equipment becomes visible on the catalogue; the vendor is told.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Reject verification', description: 'The reason goes to the vendor, who can fix and resubmit.' })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Suspend vendor',
    description:
      'Their equipment leaves the catalogue at once; rentals already under way go on. The vendor ' +
      'can still sign in. To block the whole account, use Suspend User on /admin/customers.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Lift the suspension — back to verified, or to review if never verified' })
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
  @ApiOperation({ summary: 'Customer Accounts', description: 'Everyone who books, companies and individuals. Admins are left out.' })
  @ApiPaginatedResponse(CustomerRowResponse)
  @ApiStandardErrors({ badRequest: 'A filter is not valid.' })
  list(@Query() query: AdminCustomersQuery): Promise<Paginated<CustomerRowResponse>> {
    return this.customers.list(query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export (CSV)', description: 'Same filters as the table, with total spend.' })
  @ApiOkResponse({ description: 'A CSV file, one row per customer.', content: CSV_CONTENT })
  @ApiStandardErrors()
  async export(
    @Query() query: AdminCustomersQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendCsv(res, await this.customers.exportCsv(query), 'eskista-customers');
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Customer detail',
    description: 'The representative, the verification document, open bookings (Open Booking File), recent ones, spend.',
  })
  @ApiParam(CUSTOMER_ID)
  @ApiOkResponse({ type: CustomerDetailResponse })
  @ApiStandardErrors({ notFound: 'Customer not found' })
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerDetailResponse> {
    return this.customers.detail(id);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({
    summary: 'Grant the Verified customer badge',
    description: 'From their uploaded business document. Never needed to book — it is a badge.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Refuse the badge — the document does not check out' })
  @ApiParam(CUSTOMER_ID)
  @ApiOkResponse({ type: CustomerDetailResponse })
  @ApiStandardErrors({ badRequest: '`reason` missing or too short.', notFound: 'This customer has no profile yet' })
  rejectVerification(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ): Promise<CustomerDetailResponse> {
    return this.customers.rejectVerification(adminId, id, dto.reason);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.SUPPORT)
  @ApiOperation({
    summary: 'Suspend User',
    description:
      'Blocks sign-in to every part of Eskista — customer, vendor and talent alike — and ends ' +
      'their sessions. Admin accounts are suspended from the admin team screen instead.',
  })
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
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.SUPPORT)
  @ApiOperation({ summary: 'Lift a Suspend User' })
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
