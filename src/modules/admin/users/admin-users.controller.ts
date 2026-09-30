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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminTier } from '@prisma/client';
import type { Response } from 'express';
import type { Paginated } from '../../../common/dto/pagination.dto';
import { CurrentUser } from '../../auth/auth.decorators';
import { AdminAccess } from '../core/admin-access';
import { CSV_CONTENT, sendCsv } from '../core/admin-http';
import {
  AccountReasonDto,
  AdminCustomersQuery,
  AdminVendorsQuery,
  VerifyVendorDto,
} from './admin-users.dto';
import { AdminCustomersService } from './admin-customers.service';
import { AdminVendorsService } from './admin-vendors.service';

@ApiTags('admin · vendors')
@AdminAccess()
@Controller({ path: 'admin/vendors', version: '1' })
export class AdminVendorsController {
  constructor(private readonly vendors: AdminVendorsService) {}

  @Get()
  @ApiOperation({ summary: 'Vendor Accounts' })
  list(@Query() query: AdminVendorsQuery): Promise<Paginated<Record<string, unknown>>> {
    return this.vendors.list(query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export (CSV)' })
  @ApiOkResponse({ content: CSV_CONTENT })
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
      'Lifetime earnings, pending settlement, payout accounts, documents, and what blocks verification.',
  })
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<Record<string, unknown>> {
    return this.vendors.detail(id);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Verify — accepts the documents and the signed vendor agreement' })
  verify(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyVendorDto,
  ): Promise<Record<string, unknown>> {
    return this.vendors.verify(adminId, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  reject(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ): Promise<Record<string, unknown>> {
    return this.vendors.reject(adminId, id, dto.reason);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Suspend — their equipment leaves the catalogue; open rentals go on' })
  suspend(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ): Promise<Record<string, unknown>> {
    return this.vendors.suspend(adminId, id, dto.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  reactivate(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    return this.vendors.reactivate(adminId, id);
  }
}

@ApiTags('admin · customers')
@AdminAccess()
@Controller({ path: 'admin/customers', version: '1' })
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @Get()
  @ApiOperation({ summary: 'Customer Accounts' })
  list(@Query() query: AdminCustomersQuery): Promise<Paginated<Record<string, unknown>>> {
    return this.customers.list(query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export (CSV)' })
  @ApiOkResponse({ content: CSV_CONTENT })
  async export(
    @Query() query: AdminCustomersQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendCsv(res, await this.customers.exportCsv(query), 'eskista-customers');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Customer detail — representative, active bookings, document' })
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<Record<string, unknown>> {
    return this.customers.detail(id);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  @ApiOperation({ summary: 'Grant the Verified customer badge' })
  verify(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    return this.customers.verify(adminId, id);
  }

  @Post(':id/reject-verification')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN)
  rejectVerification(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ): Promise<Record<string, unknown>> {
    return this.customers.rejectVerification(adminId, id, dto.reason);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.SUPPORT)
  @ApiOperation({ summary: 'Suspend User — blocks sign-in to every part of Eskista' })
  suspend(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ): Promise<Record<string, unknown>> {
    return this.customers.suspend(adminId, id, dto.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @AdminAccess(AdminTier.ADMIN, AdminTier.SUPPORT)
  reactivate(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    return this.customers.reactivate(adminId, id);
  }
}
