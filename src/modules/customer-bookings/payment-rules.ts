import { AgreementStatus, BookingStatus } from '@prisma/client';

/**
 * Why a booking cannot be paid right now, or null when it can.
 *
 * Shared by the single-booking payment and the combined invoice, so paying five bookings
 * together is held to exactly the rules each would be held to alone. Payment opens once the
 * signed agreement is **uploaded**; Eskista's review of the scan runs in parallel. No
 * agreement issued yet means nothing to wait for.
 */
export function paymentBlocker(
  status: BookingStatus,
  hasPending: boolean,
  agreements: { status: AgreementStatus }[] = [],
): string | null {
  if (status === BookingStatus.DRAFT) {
    return 'Submit your request before paying.';
  }
  if (status === BookingStatus.REQUEST_SUBMITTED || status === BookingStatus.ESKISTA_REVIEW) {
    return 'Eskista is still reviewing your request.';
  }
  if (
    status === BookingStatus.CANCELLED ||
    status === BookingStatus.REJECTED ||
    status === BookingStatus.EXPIRED
  ) {
    return 'This booking is closed.';
  }
  if (status !== BookingStatus.AWAITING_PAYMENT) {
    return 'This booking is already paid.';
  }
  const unsigned = agreements.some(
    (a) => a.status === AgreementStatus.AWAITING_UPLOAD || a.status === AgreementStatus.REJECTED,
  );
  if (unsigned) {
    return 'Download, sign and upload the rental agreement first.';
  }
  if (agreements.some((a) => a.status === AgreementStatus.DECLINED)) {
    return 'You declined the agreement for this booking. Contact Eskista to continue.';
  }
  if (hasPending) {
    return 'Eskista is verifying your previous payment.';
  }
  return null;
}

export interface TelebirrAccount {
  number: string;
  accountName: string;
}

export interface BankAccount {
  bank: string;
  accountName: string;
  accountNumber: string;
}

/** Eskista's Telebirr account from the `payment.accounts` setting, if configured. */
export function readTelebirr(accounts: Record<string, unknown>): TelebirrAccount | null {
  const raw = accounts.telebirr;
  if (typeof raw !== 'object' || raw === null) return null;
  const { number, accountName } = raw as Record<string, unknown>;
  if (typeof number !== 'string' || typeof accountName !== 'string') return null;
  return { number, accountName };
}

/** Eskista's bank account from the `payment.accounts` setting, if configured. */
export function readBank(accounts: Record<string, unknown>): BankAccount | null {
  const raw = accounts.bank;
  if (typeof raw !== 'object' || raw === null) return null;
  const { bank, accountName, accountNumber } = raw as Record<string, unknown>;
  if (
    typeof bank !== 'string' ||
    typeof accountName !== 'string' ||
    typeof accountNumber !== 'string'
  ) {
    return null;
  }
  return { bank, accountName, accountNumber };
}
