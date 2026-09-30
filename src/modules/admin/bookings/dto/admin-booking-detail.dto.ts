import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { AdminAgreementResponse } from '../../agreements/admin-agreements';
import { InspectionResponse } from '../../inspections/dto/inspection.dto';
import { PaymentRowResponse } from '../../payments/dto/admin-payments.dto';
import { AdminBookingRowResponse, LegResponse, PartyResponse } from './admin-bookings.dto';

/** The admin Booking Detail: header, lifecycle, next actions, and the four tabs. */

export class AdminStepResponse {
  @ApiProperty({ example: 'OUTGOING_INSPECTION' }) key!: string;
  @ApiProperty({ example: 'Outgoing Inspection' }) label!: string;
  @ApiProperty({ enum: ['DONE', 'IN_PROGRESS', 'PENDING'], example: 'IN_PROGRESS' }) state!: string;
}

export class AdminActionResponse {
  @ApiProperty({
    example: 'OUTGOING_INSPECTION',
    enum: [
      'APPROVE',
      'REJECT',
      'ASSIGN_UNIT',
      'REVIEW_AGREEMENT',
      'VERIFY_PAYMENT',
      'RECEIVE_AT_HUB',
      'OUTGOING_INSPECTION',
      'DISPATCH',
      'ADVANCE_DELIVERY',
      'MARK_RETURN_RECEIVED',
      'RETURN_INSPECTION',
      'REFUND_DEPOSIT',
      'SETTLE',
      'MARK_PAYOUT_PAID',
      'RETURN_TO_VENDOR',
      'CLOSE',
      'START_ENGAGEMENT',
      'COMPLETE_ENGAGEMENT',
      'CANCEL',
    ],
    description:
      'Which endpoint the button calls: APPROVE → /approve, RECEIVE_AT_HUB → /receive-at-hub, ' +
      'OUTGOING_INSPECTION → /inspections/outgoing, DISPATCH and ADVANCE_DELIVERY → /delivery, ' +
      'MARK_RETURN_RECEIVED → /return, RETURN_INSPECTION → /inspections/return, REFUND_DEPOSIT → ' +
      '/deposit-refund, SETTLE → /settle, MARK_PAYOUT_PAID → /admin/settlements/:ref/pay, ' +
      'REVIEW_AGREEMENT → /admin/agreements, VERIFY_PAYMENT → /admin/payments.',
  })
  key!: string;
  @ApiProperty({ example: 'Update Outgoing Inspection' }) label!: string;
  @ApiProperty({ example: true, description: 'Style this one as the primary button.' })
  primary!: boolean;
  @ApiProperty({ example: true }) enabled!: boolean;
  @ApiPropertyOptional({ nullable: true, example: null, description: 'Why it is disabled.' })
  disabledReason!: string | null;
}

export class BookingCustomerDetailResponse extends PartyResponse {
  @ApiProperty({ enum: ['INDIVIDUAL', 'COMPANY'], example: 'COMPANY' }) kind!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Addis Ababa' }) city!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Bole, Atlas area' }) address!: string | null;
  @ApiProperty({ example: true, description: 'The "Verified customer" badge.' }) verified!: boolean;
  @ApiProperty({ example: true, description: '"ID document on file".' }) idDocumentOnFile!: boolean;
  @ApiPropertyOptional({ nullable: true, example: '/api/v1/files/customers/7c1e…/license.pdf' })
  idDocumentUrl!: string | null;
}

export class BookingUnitResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ nullable: true, example: 'FX3-002' }) label!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'SNY-FX3-2291' }) serialNumber!: string | null;
  @ApiProperty({
    enum: ['VENDOR', 'HUB', 'CLIENT'],
    example: 'HUB',
    description: 'Current custody.',
  })
  custody!: string;
  @ApiPropertyOptional({
    nullable: true,
    enum: ['PRISTINE', 'EXCELLENT', 'GOOD', 'FAIR', 'NEEDS_ATTENTION', 'DAMAGED'],
    example: 'EXCELLENT',
  })
  grade!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-27T08:30:00.000Z' })
  lastInspectedAt!: string | null;
  @ApiProperty({ enum: ['AVAILABLE', 'MAINTENANCE', 'RETIRED'], example: 'AVAILABLE' })
  status!: string;
}

export class BookingDeliveryInfoResponse {
  @ApiPropertyOptional({ nullable: true, enum: ['DELIVERY', 'PICKUP'], example: 'DELIVERY' })
  collectionMethod!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Bole, near Edna Mall, Addis Ababa' })
  address!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Call on arrival; gate 2.' }) notes!:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 1 }) quantity!: number | null;
  @ApiPropertyOptional({
    nullable: true,
    example: '2026-10-03T14:00:00.000Z',
    description: 'The return deadline.',
  })
  dueAt!: string | null;
}

export class BookingTalentResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Dawit Bekele' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Cinematographer' }) role!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911778899' }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'dawit@example.com' }) email!: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ example: 1_200_000, description: "The talent's own price for this engagement." })
  earningsMinor!: number;
}

export class BookingEngagementResponse {
  @ApiProperty({ example: 'Sheraton Addis, Addis Ababa' }) location!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Sheraton Addis' }) venue!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Addis Ababa' }) city!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '08:00' }) startTime!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '18:00' }) endTime!: string | null;
  @ApiProperty({ enum: ['PER_DAY', 'PER_PROJECT'], example: 'PER_DAY' }) engagementModel!: string;
  @ApiPropertyOptional({ nullable: true, example: 1 }) headcount!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 'Own camera kit preferred.' })
  requirements!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'FROM_10K_TO_25K' }) budgetBand!: string | null;
  @ApiPropertyOptional({ nullable: true, example: null }) budgetMinor!: number | null;
}

export class BookingInvitationResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) talentProfileId!: string;
  @ApiProperty({ example: 'Hanna Girma' }) talentName!: string;
  @ApiProperty({
    enum: [
      'INVITED',
      'ACCEPTED',
      'DECLINED',
      'EXPIRED',
      'WITHDRAWN',
      'HIRED',
      'REJECTED',
      'CANCELLED',
    ],
    example: 'ACCEPTED',
  })
  status!: string;
  @ApiProperty({ example: '2026-09-26T10:00:00.000Z' }) invitedAt!: string;
  @ApiPropertyOptional({ nullable: true }) respondedAt!: string | null;
  @ApiProperty({ example: '2026-09-28T10:00:00.000Z' }) expiresAt!: string;
  @ApiPropertyOptional({ nullable: true }) declineReason!: string | null;
}

export class BookingVendorResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Afro Studio' }) businessName!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Shebelaw Bogale' }) contactName!: string | null;
  @ApiPropertyOptional({ nullable: true, example: '+251911000002' }) phone!: string | null;
  @ApiProperty({ example: 'hello@afrostudio.et' }) email!: string;
  @ApiProperty({ example: 'Addis Ababa' }) location!: string;
  @ApiProperty({
    example: 900_000,
    description: "The vendor's price for this rental — what they are paid.",
  })
  earningsMinor!: number;
  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'DECLINED'], example: 'ACCEPTED' })
  response!: string;
  @ApiPropertyOptional({ nullable: true }) respondedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) declineReason!: string | null;
  @ApiProperty({ enum: ['NOT_DUE', 'PENDING', 'OVERDUE', 'PAID', 'ON_HOLD'], example: 'NOT_DUE' })
  payoutStatus!: string;
}

export class AttachmentLinkResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'moodboard.pdf' }) fileName!: string;
  @ApiProperty({ example: '/api/v1/files/bookings/ESK-TLT-9001/attachments/5d2e.pdf' })
  url!: string;
}

export class BookingOverviewTabResponse {
  @ApiPropertyOptional({ nullable: true, example: 'Commercial shoot for a coffee brand' })
  purpose!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'COMMERCIAL_PRODUCTION' }) projectType!:
    string | null;
  @ApiProperty({ example: '+251911223344' }) contactPhone!: string;
  @ApiPropertyOptional({ nullable: true }) additionalPhone!: string | null;
  @ApiProperty({ type: BookingCustomerDetailResponse }) customer!: BookingCustomerDetailResponse;
  @ApiProperty({ type: [BookingUnitResponse], description: 'The physical units assigned.' })
  units!: BookingUnitResponse[];
  @ApiProperty({ type: BookingDeliveryInfoResponse }) delivery!: BookingDeliveryInfoResponse;
  @ApiPropertyOptional({ type: BookingTalentResponse, nullable: true })
  talent!: BookingTalentResponse | null;
  @ApiPropertyOptional({ type: BookingEngagementResponse, nullable: true })
  engagement!: BookingEngagementResponse | null;
  @ApiProperty({
    type: [BookingInvitationResponse],
    description: 'Talent requests: who was invited.',
  })
  invitations!: BookingInvitationResponse[];
  @ApiPropertyOptional({ type: BookingVendorResponse, nullable: true })
  vendor!: BookingVendorResponse | null;
  @ApiPropertyOptional({ nullable: true, example: 'Abel Tesfaye' }) approvedBy!: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedAt!: string | null;
  @ApiProperty({ type: [AttachmentLinkResponse], description: "The customer's reference files." })
  attachments!: AttachmentLinkResponse[];
}

export class HandoverResponse {
  @ApiPropertyOptional({ nullable: true, enum: ['EXCELLENT', 'GOOD', 'FAIR', 'NEEDS_ATTENTION'] })
  condition!: string | null;
  @ApiPropertyOptional({ nullable: true }) preparedAt!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    enum: ['DELIVERY', 'PICKUP'],
    description: 'The vendor brings it to the hub, or Eskista collects.',
  })
  method!: string | null;
  @ApiPropertyOptional({ nullable: true }) address!: string | null;
  @ApiPropertyOptional({ nullable: true }) contactPhone!: string | null;
  @ApiPropertyOptional({ nullable: true, description: "The vendor's Confirm Handover." })
  handedOverAt!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Receive at Hub.' }) receivedAtHubAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) returnedToVendorAt!: string | null;
  @ApiPropertyOptional({ nullable: true, description: "The vendor's Confirm Return." })
  returnConfirmedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Set when the vendor disputed the return.' })
  returnDisputeNote!: string | null;
  @ApiProperty({ type: [String], description: "The vendor's pre-handover photos." })
  photos!: string[];
}

export class BookingDeliveryTabResponse {
  @ApiPropertyOptional({ type: LegResponse, nullable: true }) outbound!: LegResponse | null;
  @ApiPropertyOptional({ type: LegResponse, nullable: true }) return!: LegResponse | null;
  @ApiPropertyOptional({ type: HandoverResponse, nullable: true })
  handover!: HandoverResponse | null;
  @ApiPropertyOptional({ type: InspectionResponse, nullable: true })
  outgoingInspection!: InspectionResponse | null;
  @ApiPropertyOptional({ type: InspectionResponse, nullable: true })
  returnInspection!: InspectionResponse | null;
}

export class AdjustmentLineResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 150_000, description: 'Signed: positive adds to the payout.' })
  amountMinor!: number;
  @ApiProperty({ example: 'Damage compensation withheld from the deposit' }) reason!: string;
  @ApiProperty({ example: '2026-10-04T10:00:00.000Z' }) createdAt!: string;
}

export class BookingPayoutResponse {
  @ApiPropertyOptional({ nullable: true, example: 'STL-0012' }) reference!: string | null;
  @ApiProperty({ enum: ['PENDING', 'IN_BATCH', 'PAID', 'ON_HOLD'], example: 'PENDING' })
  status!: string;
  @ApiProperty({ enum: ['PENDING', 'OVERDUE', 'PAID', 'ON_HOLD'], example: 'PENDING' })
  displayStatus!: string;
  @ApiProperty({ example: 1_035_000 }) grossMinor!: number;
  @ApiProperty({ example: 135_000 }) commissionMinor!: number;
  @ApiProperty({ example: 150_000 }) adjustmentMinor!: number;
  @ApiProperty({ example: 1_050_000 }) netMinor!: number;
  @ApiPropertyOptional({ nullable: true }) expectedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) paidAt!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Sara Mekonnen' }) paidBy!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'FT26281PAY0042' }) payoutReference!:
    string | null;
  @ApiProperty({ type: [AdjustmentLineResponse] }) adjustments!: AdjustmentLineResponse[];
  @ApiPropertyOptional({ nullable: true, description: 'The supplier confirmed the money arrived.' })
  payeeConfirmedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'The supplier reported it missing.' })
  payeeDisputeNote!: string | null;
}

export class AccountSnapshotResponse {
  @ApiProperty({ enum: ['TELEBIRR', 'BANK'], example: 'TELEBIRR' }) channel!: string;
  @ApiProperty({ example: 'Telebirr' }) provider!: string;
  @ApiProperty({ example: 'Afro Studio' }) accountName!: string;
  @ApiProperty({ example: '0911000002' }) accountNumber!: string;
}

export class DepositRefundResponse {
  @ApiPropertyOptional({ nullable: true, example: 350_000 }) amountMinor!: number | null;
  @ApiProperty({ example: '2026-10-05T09:00:00.000Z' }) refundedAt!: string;
  @ApiPropertyOptional({ nullable: true, example: 'FT26280ABC123' }) reference!: string | null;
}

export class InvoiceRefResponse {
  @ApiProperty({ example: 'ESK-INV-2026-000148' }) number!: string;
  @ApiProperty({ example: false }) combined!: boolean;
  @ApiProperty({ enum: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'], example: 'ISSUED' })
  status!: string;
}

export class BookingSettlementTabResponse {
  @ApiProperty({ example: 'ETB' }) currency!: string;
  @ApiProperty({ example: 1_035_000, description: 'Rental at the customer price, VAT included.' })
  rentalMinor!: number;
  @ApiProperty({ example: 50_000 }) deliveryFeeMinor!: number;
  @ApiProperty({ example: 0 }) serviceFeeMinor!: number;
  @ApiProperty({ example: 0 }) discountMinor!: number;
  @ApiProperty({ example: 141_522 }) vatMinor!: number;
  @ApiProperty({ example: 1500 }) vatRateBps!: number;
  @ApiProperty({ example: 500_000 }) depositHeldMinor!: number;
  @ApiProperty({ example: 1_585_000, description: 'What the customer owes: total plus deposit.' })
  totalChargedMinor!: number;
  @ApiProperty({ example: 1_585_000, description: 'Verified so far.' }) paidMinor!: number;
  @ApiProperty({ example: 0 }) balanceMinor!: number;
  @ApiProperty({ example: 135_000, description: "Eskista's share." }) commissionMinor!: number;
  @ApiProperty({ example: 1500 }) commissionRateBps!: number;
  @ApiProperty({ example: 900_000, description: 'What the supplier is paid.' })
  supplierNetMinor!: number;
  @ApiPropertyOptional({
    nullable: true,
    example: 350_000,
    description: 'Deposit released by the return inspection.',
  })
  depositReleasedMinor!: number | null;
  @ApiPropertyOptional({ type: DepositRefundResponse, nullable: true })
  depositRefund!: DepositRefundResponse | null;
  @ApiPropertyOptional({ type: InvoiceRefResponse, nullable: true })
  invoice!: InvoiceRefResponse | null;
  @ApiPropertyOptional({ type: BookingPayoutResponse, nullable: true })
  payout!: BookingPayoutResponse | null;
  @ApiPropertyOptional({
    type: AccountSnapshotResponse,
    nullable: true,
    description: "The supplier's primary payout account.",
  })
  payoutAccount!: AccountSnapshotResponse | null;
  @ApiProperty({ type: [PaymentRowResponse], description: 'Payment evidence.' })
  payments!: PaymentRowResponse[];
}

export class BookingDocumentResponse {
  @ApiProperty({
    enum: [
      'PAYMENT_RECEIPT',
      'AGREEMENT',
      'SIGNED_AGREEMENT',
      'OUTGOING_INSPECTION_SHEET',
      'RETURN_INSPECTION_SHEET',
      'INVOICE',
      'SETTLEMENT_RECORD',
      'HANDOVER_PHOTO',
    ],
    example: 'OUTGOING_INSPECTION_SHEET',
  })
  kind!: string;
  @ApiProperty({ example: 'Outgoing Check-out inspection sheet' }) title!: string;
  @ApiProperty({ example: '/api/v1/admin/inspections/2b0d6c1e-…/sheet.pdf' }) url!: string;
  @ApiPropertyOptional({ example: 'UNDER_REVIEW', description: 'Signed agreements only.' })
  status?: string;
  @ApiProperty({ example: 'Dawit (hub technician)' }) uploadedBy!: string;
  @ApiPropertyOptional({ nullable: true, example: '2026-09-27T08:30:00.000Z' })
  uploadedAt!: string | null;
}

export class BookingIncidentSummaryResponse {
  @ApiProperty({ example: 'ESK-INC-00042' }) reference!: string;
  @ApiProperty({ example: 'TECHNICAL_MALFUNCTION' }) type!: string;
  @ApiProperty({ example: 'Technical Malfunction' }) typeLabel!: string;
  @ApiProperty({ enum: ['REPORTED', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'] }) status!: string;
  @ApiProperty({ enum: ['CUSTOMER', 'VENDOR', 'TALENT', 'ADMIN'] }) reporterRole!: string;
  @ApiProperty({ example: 'The second battery will not hold a charge.' }) description!: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: string | null;
}

export class BookingActivityResponse {
  @ApiProperty({ example: '2026-09-27T08:30:00.000Z' }) at!: string;
  @ApiPropertyOptional({ nullable: true, enum: BookingStatus }) from!: BookingStatus | null;
  @ApiProperty({ enum: BookingStatus }) to!: BookingStatus;
  @ApiProperty({ example: 'Abel Tesfaye', description: 'Who did it, or "System".' }) actor!: string;
  @ApiPropertyOptional({ nullable: true, enum: ['CUSTOMER', 'VENDOR', 'TALENT', 'ADMIN'] })
  actorRole!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'Received at the Eskista hub' }) reason!:
    string | null;
}

export class AdminBookingDetailResponse {
  @ApiProperty({
    type: AdminBookingRowResponse,
    description: 'The header — the same shape as a table row.',
  })
  summary!: AdminBookingRowResponse;
  @ApiProperty({
    type: [AdminStepResponse],
    description: 'Thirteen steps for equipment, six for talent.',
  })
  timeline!: AdminStepResponse[];
  @ApiProperty({
    type: [AdminActionResponse],
    description: 'What can happen next, in button order.',
  })
  actions!: AdminActionResponse[];
  @ApiProperty({ type: BookingOverviewTabResponse, description: 'Overview tab.' })
  overview!: BookingOverviewTabResponse;
  @ApiProperty({ type: BookingDeliveryTabResponse, description: 'Delivery & Inspection tab.' })
  delivery!: BookingDeliveryTabResponse;
  @ApiProperty({ type: BookingSettlementTabResponse, description: 'Settlement tab.' })
  settlement!: BookingSettlementTabResponse;
  @ApiProperty({ type: [BookingDocumentResponse], description: 'Documents tab.' })
  documents!: BookingDocumentResponse[];
  @ApiProperty({ type: [AdminAgreementResponse] }) agreements!: AdminAgreementResponse[];
  @ApiProperty({ type: [BookingIncidentSummaryResponse] })
  incidents!: BookingIncidentSummaryResponse[];
  @ApiProperty({ type: [BookingActivityResponse], description: 'Status history, newest first.' })
  activity!: BookingActivityResponse[];
}

export class CancelledBookingResponse extends AdminBookingDetailResponse {
  @ApiProperty({
    example: 1_585_000,
    description: 'Money already verified, for finance to return.',
  })
  refundDueMinor!: number;
}

export class FreeUnitResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ nullable: true, example: 'FX3-002' }) label!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'SNY-FX3-2291' }) serialNumber!: string | null;
  @ApiProperty({
    example: true,
    description: 'In service and not held by another approved booking on these dates.',
  })
  free!: boolean;
}

export class BookingCountsResponse {
  @ApiProperty({ example: 12 }) bookingRequests!: number;
  @ApiProperty({ example: 8 }) activeRentals!: number;
  @ApiProperty({ example: 3 }) deliveriesAndPickups!: number;
  @ApiProperty({ example: 4 }) hiringRequests!: number;
}
