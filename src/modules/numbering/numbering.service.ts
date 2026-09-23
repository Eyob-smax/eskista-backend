import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type SequenceScope =
  'booking' | 'talent-booking' | 'agreement' | 'incident' | 'invoice' | 'settlement-batch';

/**
 * Gapless, human-readable identifiers.
 *
 * Invoice numbers must be sequential with no gaps for accounting, which rules out
 * generating them optimistically and rules out `nanoid`. Each `nextValue` call performs
 * an atomic upsert-and-increment in a single statement, and is intended to be called
 * inside the same transaction as the row it numbers — so a rolled-back booking does not
 * burn an invoice number.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserves the next value for a scope/period pair.
   *
   * Implemented as a raw upsert with `lastValue = NumberSequence.lastValue + 1` so the
   * increment happens inside the database. Two concurrent callers serialise on the
   * unique index rather than racing in application code.
   */
  async nextValue(
    scope: SequenceScope,
    period: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;

    const rows = await client.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO "NumberSequence" ("id", "scope", "period", "lastValue", "updatedAt")
      VALUES (gen_random_uuid(), ${scope}, ${period}, 1, now())
      ON CONFLICT ("scope", "period")
      DO UPDATE SET "lastValue" = "NumberSequence"."lastValue" + 1, "updatedAt" = now()
      RETURNING "lastValue"
    `;

    const value = rows[0]?.lastValue;
    if (typeof value !== 'number') {
      throw new Error(`Failed to reserve a number for ${scope}/${period}`);
    }
    return value;
  }

  /**
   * Customer-facing booking reference, e.g. `ESK-10482`.
   *
   * The designs show a five-digit number, so the sequence is offset to start at 10000 and
   * keep the shape stable for the platform's first 90,000 bookings.
   */
  async nextBookingReference(tx?: Prisma.TransactionClient): Promise<string> {
    const value = await this.nextValue('booking', 'all', tx);
    return `ESK-${10_000 + value}`;
  }

  /**
   * Talent engagement reference, e.g. `ESK-TLT-8847`.
   *
   * A separate prefix and its own counter, because the designs print talent requests as
   * `ESK-TLT-…` and equipment rentals as `ESK-…`. Sharing one sequence would make the two
   * indistinguishable at a glance, which is the whole point of the prefix.
   */
  async nextTalentBookingReference(tx?: Prisma.TransactionClient): Promise<string> {
    const value = await this.nextValue('talent-booking', 'all', tx);
    return `ESK-TLT-${1000 + value}`;
  }

  /** Agreement reference, e.g. `ESK-AGR-00031`. */
  async nextAgreementReference(tx?: Prisma.TransactionClient): Promise<string> {
    const value = await this.nextValue('agreement', 'all', tx);
    return `ESK-AGR-${String(value).padStart(5, '0')}`;
  }

  /** Incident reference, e.g. `ESK-INC-00042`. */
  async nextIncidentReference(tx?: Prisma.TransactionClient): Promise<string> {
    const value = await this.nextValue('incident', 'all', tx);
    return `ESK-INC-${String(value).padStart(5, '0')}`;
  }

  /** Invoice number, e.g. `ESK-INV-2026-000148`. Resets its counter each calendar year. */
  async nextInvoiceNumber(now: Date = new Date(), tx?: Prisma.TransactionClient): Promise<string> {
    const year = now.getUTCFullYear();
    const value = await this.nextValue('invoice', String(year), tx);
    return `ESK-INV-${year}-${String(value).padStart(6, '0')}`;
  }

  /** Settlement batch reference, e.g. `ESK-STL-2026-09-0007`. */
  async nextSettlementBatchReference(
    now: Date = new Date(),
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const value = await this.nextValue('settlement-batch', period, tx);
    return `ESK-STL-${period}-${String(value).padStart(4, '0')}`;
  }
}
