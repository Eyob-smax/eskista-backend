/**
 * The admin side of the demo data: the dashboard team, Eskista's operating accounts,
 * supplier payout accounts, the hub's view of the gear, promoted content, and open work
 * for every admin queue — a slip to verify, a scan to review, issues on the desk.
 *
 * Runs after the main seed and is idempotent: every step checks before it writes.
 */
import {
  AccountChannel,
  AdminTier,
  AgreementStatus,
  BookingStatus,
  FeatureTier,
  IncidentPhase,
  IncidentStatus,
  IncidentType,
  InspectionGrade,
  InspectionKind,
  PaymentMethod,
  PaymentStatus,
  Role,
  UnitCustody,
  type PrismaClient,
} from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

const DAY = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

/** Dev only. Production admins are created with `pnpm admin:create`. */
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'eskista-admin-2026';

const TEAM: { email: string; name: string; tier: AdminTier; title: string; phone: string }[] = [
  { email: 'ops@eskista.et', name: 'Abel Tesfaye', tier: AdminTier.SUPER_ADMIN, title: 'Operations Lead', phone: '+251911000001' },
  { email: 'finance@eskista.et', name: 'Sara Mekonnen', tier: AdminTier.FINANCE, title: 'Finance Officer', phone: '+251911000091' },
  { email: 'support@eskista.et', name: 'Henok Girma', tier: AdminTier.SUPPORT, title: 'Support Admin', phone: '+251911000092' },
];

const OUT_OR_BACK: BookingStatus[] = [
  BookingStatus.DELIVERY_PICKUP,
  BookingStatus.IN_PROGRESS,
  BookingStatus.RENTAL_COMPLETED,
  BookingStatus.RETURN_SCHEDULED,
  BookingStatus.RETURN_RECEIVED,
  BookingStatus.INSPECTION,
  BookingStatus.SETTLEMENT,
  BookingStatus.CLOSED,
];

export async function seedAdminSide(prisma: PrismaClient): Promise<void> {
  await seedTeam(prisma);
  await seedOperatingAccounts(prisma);
  await seedPayoutAccounts(prisma);
  await backfillReferences(prisma);
  await seedHubState(prisma);
  await seedCategoriesContent(prisma);
  await seedFeatured(prisma);
  await seedOpenWork(prisma);
}

async function seedTeam(prisma: PrismaClient): Promise<void> {
  const hash = await hashPassword(SEED_ADMIN_PASSWORD);
  for (const m of TEAM) {
    const user = await prisma.user.upsert({
      where: { email: m.email },
      update: { name: m.name },
      create: { email: m.email, name: m.name, emailVerified: true, activeRole: Role.ADMIN },
    });
    await prisma.roleMembership.upsert({
      where: { userId_role: { userId: user.id, role: Role.ADMIN } },
      update: {},
      create: { userId: user.id, role: Role.ADMIN },
    });
    await prisma.adminProfile.upsert({
      where: { userId: user.id },
      update: { tier: m.tier, title: m.title, phone: m.phone },
      create: { userId: user.id, tier: m.tier, title: m.title, phone: m.phone },
    });
    const credential = await prisma.account.findFirst({
      where: { userId: user.id, providerId: 'credential' },
    });
    if (!credential) {
      await prisma.account.create({
        data: { userId: user.id, accountId: user.id, providerId: 'credential', password: hash },
      });
    }
  }
}

async function seedOperatingAccounts(prisma: PrismaClient): Promise<void> {
  if ((await prisma.collectionAccount.count()) > 0) return;
  await prisma.collectionAccount.createMany({
    data: [
      { channel: AccountChannel.TELEBIRR, provider: 'Telebirr', accountName: 'Eskista Equipment Rentals', accountNumber: '0911234567', merchantId: '882910', sortOrder: 0 },
      { channel: AccountChannel.BANK, provider: 'Commercial Bank of Ethiopia', accountName: 'Eskista Marketplace PLC', accountNumber: '1000234567890', sortOrder: 1 },
      { channel: AccountChannel.BANK, provider: 'Awash Bank', accountName: 'Eskista Marketplace PLC', accountNumber: '01320012345600', sortOrder: 2 },
    ],
  });
}

async function seedPayoutAccounts(prisma: PrismaClient): Promise<void> {
  const vendors = await prisma.vendorProfile.findMany({ select: { id: true, businessName: true, phone: true } });
  for (const [i, v] of vendors.entries()) {
    if ((await prisma.payoutAccount.count({ where: { vendorId: v.id } })) > 0) continue;
    await prisma.payoutAccount.createMany({
      data: [
        { vendorId: v.id, channel: AccountChannel.TELEBIRR, provider: 'Telebirr', accountName: v.businessName, accountNumber: v.phone ?? `09110000${10 + i}`, isPrimary: true },
        { vendorId: v.id, channel: AccountChannel.BANK, provider: 'Commercial Bank of Ethiopia', accountName: v.businessName, accountNumber: `100045678${String(1000 + i)}`, isPrimary: false },
      ],
    });
  }
  const talents = await prisma.talentProfile.findMany({ select: { id: true, displayName: true } });
  for (const [i, t] of talents.entries()) {
    if ((await prisma.payoutAccount.count({ where: { talentProfileId: t.id } })) > 0) continue;
    await prisma.payoutAccount.create({
      data: { talentProfileId: t.id, channel: AccountChannel.BANK, provider: 'Commercial Bank of Ethiopia', accountName: t.displayName, accountNumber: `100077788${String(2000 + i)}`, isPrimary: true },
    });
  }
}

/** PAY- and STL- references for rows the main seed wrote without them. */
async function backfillReferences(prisma: PrismaClient): Promise<void> {
  const next = async (scope: 'payment' | 'settlement', prefix: string) => {
    const rows = await prisma.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO "NumberSequence" ("id", "scope", "period", "lastValue", "updatedAt")
      VALUES (gen_random_uuid(), ${scope}, 'all', 1, now())
      ON CONFLICT ("scope", "period")
      DO UPDATE SET "lastValue" = "NumberSequence"."lastValue" + 1, "updatedAt" = now()
      RETURNING "lastValue"`;
    return `${prefix}-${String(rows[0].lastValue).padStart(4, '0')}`;
  };
  const payments = await prisma.payment.findMany({ where: { reference: null }, orderBy: { submittedAt: 'asc' } });
  const byReceipt = new Map<string, string>();
  for (const p of payments) {
    const ref = byReceipt.get(p.receiptFileKey) ?? (await next('payment', 'PAY'));
    byReceipt.set(p.receiptFileKey, ref);
    await prisma.payment.update({
      where: { id: p.id },
      data: {
        reference: ref,
        ...(p.status === PaymentStatus.VERIFIED ? { receivedAmountMinor: p.amountMinor, payerName: 'Seeded payer' } : {}),
      },
    });
  }
  const settlements = await prisma.settlement.findMany({ where: { reference: null }, orderBy: { createdAt: 'asc' } });
  for (const s of settlements) {
    const account = await prisma.payoutAccount.findFirst({
      where: s.vendorId ? { vendorId: s.vendorId } : { talentProfileId: s.talentProfileId },
      orderBy: { isPrimary: 'desc' },
    });
    await prisma.settlement.update({
      where: { id: s.id },
      data: {
        reference: await next('settlement', 'STL'),
        ...(s.paidAt && account
          ? {
              payoutChannel: account.channel,
              payoutProvider: account.provider,
              payoutAccountName: account.accountName,
              payoutAccountNumber: account.accountNumber,
            }
          : {}),
      },
    });
  }
}

/**
 * Where each unit is, and the hub's own records: gear that has gone out was received from
 * the vendor and passed its outgoing inspection.
 */
async function seedHubState(prisma: PrismaClient): Promise<void> {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@eskista.et' } });
  const bookings = await prisma.booking.findMany({
    where: { type: 'EQUIPMENT', status: { in: [...OUT_OR_BACK, BookingStatus.BOOKING_CONFIRMED] } },
    include: { assignedUnits: true, handover: true, inspections: true },
  });
  for (const b of bookings) {
    // One unit per seeded rental: take the first of the listing if none was assigned.
    let unitIds = b.assignedUnits.map((u) => u.unitId);
    if (unitIds.length === 0 && b.listingId) {
      const unit = await prisma.equipmentUnit.findFirst({ where: { listingId: b.listingId }, orderBy: { createdAt: 'asc' } });
      if (unit) {
        await prisma.bookingUnit.create({ data: { bookingId: b.id, unitId: unit.id } });
        unitIds = [unit.id];
      }
    }
    const custody: UnitCustody =
      b.status === BookingStatus.BOOKING_CONFIRMED
        ? UnitCustody.VENDOR
        : ([BookingStatus.IN_PROGRESS, BookingStatus.RENTAL_COMPLETED, BookingStatus.RETURN_SCHEDULED] as BookingStatus[]).includes(b.status)
          ? UnitCustody.CLIENT
          : UnitCustody.HUB;
    await prisma.equipmentUnit.updateMany({ where: { id: { in: unitIds } }, data: { custody } });

    if (!OUT_OR_BACK.includes(b.status)) continue;
    const received = new Date(b.startDate.getTime() - DAY);
    if (b.handover && !b.handover.receivedAtHubAt) {
      await prisma.vendorHandover.update({
        where: { bookingId: b.id },
        data: { receivedAtHubAt: received, handedOverAt: b.handover.handedOverAt ?? received },
      });
    }
    if (!b.inspections.some((i) => i.kind === InspectionKind.OUTGOING)) {
      await prisma.inspection.create({
        data: {
          kind: InspectionKind.OUTGOING,
          bookingId: b.id,
          unitId: unitIds[0] ?? null,
          grade: InspectionGrade.EXCELLENT,
          condition: 'EXCELLENT',
          notes: 'Sensor clean, all accessories present, batteries charged.',
          inspectorName: 'Dawit (hub technician)',
          inspectedById: admin.id,
          inspectedAt: received,
        },
      });
    }
    for (const unitId of unitIds) {
      await prisma.equipmentUnit.update({
        where: { id: unitId },
        data: { lastGrade: InspectionGrade.EXCELLENT, lastInspectedAt: received },
      });
    }
  }
}

async function seedCategoriesContent(prisma: PrismaClient): Promise<void> {
  const bySlug = new Map((await prisma.category.findMany()).map((c) => [c.slug, c]));
  const details: Record<string, { description: string; skills?: string[]; related?: string[] }> = {
    cameras: { description: 'Cinema and mirrorless bodies. Check sensor and mount on every return.', related: ['lenses', 'lighting', 'audio', 'cinematographers'] },
    lenses: { description: 'Primes, zooms and adapters. Inspect glass and mount pins.', related: ['cameras', 'grip-support'] },
    lighting: { description: 'LED panels, COB lights, modifiers and stands.', related: ['grip-support', 'cameras'] },
    audio: { description: 'Wireless kits, shotgun mics and recorders.', related: ['sound-engineers', 'cameras'] },
    'grip-support': { description: 'Tripods, gimbals, sliders and rigs.', related: ['cameras'] },
    drones: { description: 'Drones need a registered pilot; check propellers and batteries.', related: ['cinematographers'] },
    cinematographers: { description: 'Directors of photography and camera operators.', skills: ['Colour grading', 'Gimbal operation', 'Drone operation', 'Lighting design', 'Documentary'], related: ['cameras', 'lenses'] },
    photographers: { description: 'Event, product and portrait photographers.', skills: ['Wedding', 'Product', 'Portrait', 'Retouching', 'Studio lighting'], related: ['cameras', 'lighting'] },
    editors: { description: 'Offline and online editors, colourists.', skills: ['DaVinci Resolve', 'Premiere Pro', 'Colour grading', 'Motion graphics'] },
    directors: { description: 'Commercial, music video and documentary directors.', skills: ['Commercials', 'Music videos', 'Documentary', 'Script development'] },
    'sound-engineers': { description: 'Location sound and post mixing.', skills: ['Boom operation', 'Wireless mics', 'Mixing', 'Foley'], related: ['audio'] },
    'models-actors': { description: 'On-screen talent for commercials and film.', skills: ['Commercial', 'Runway', 'Voice-over', 'Stage acting'] },
  };
  for (const [slug, d] of Object.entries(details)) {
    const c = bySlug.get(slug);
    if (!c) continue;
    await prisma.category.update({
      where: { id: c.id },
      data: { description: c.description ?? d.description, ...(d.skills && c.skills.length === 0 ? { skills: d.skills } : {}) },
    });
    if ((await prisma.categoryAssociation.count({ where: { categoryId: c.id } })) === 0 && d.related) {
      const related = d.related.map((s) => bySlug.get(s)).filter((x): x is NonNullable<typeof x> => !!x);
      await prisma.categoryAssociation.createMany({
        data: related.map((r, sortOrder) => ({ categoryId: c.id, relatedId: r.id, sortOrder })),
        skipDuplicates: true,
      });
    }
  }
}

async function seedFeatured(prisma: PrismaClient): Promise<void> {
  const featured = await prisma.listing.findMany({ where: { isFeatured: true, featureTier: null }, orderBy: { createdAt: 'asc' } });
  for (const [i, l] of featured.entries()) {
    await prisma.listing.update({
      where: { id: l.id },
      data: { featureTier: i === 0 ? FeatureTier.SPOTLIGHT : FeatureTier.FEATURED, featuredAt: new Date(), featureSortOrder: i },
    });
  }
  const talent = await prisma.talentProfile.findFirst({ where: { status: 'VERIFIED', featureTier: null }, orderBy: { ratingAvg: 'desc' } });
  if (talent && (await prisma.talentProfile.count({ where: { featureTier: { not: null } } })) === 0) {
    await prisma.talentProfile.update({ where: { id: talent.id }, data: { featureTier: FeatureTier.HIGHLIGHTED, featuredAt: new Date() } });
  }
}

/** Something waiting in each admin queue, so every screen has a row to open. */
async function seedOpenWork(prisma: PrismaClient): Promise<void> {
  // A slip to verify and a scan to review, on the booking awaiting payment.
  const awaiting = await prisma.booking.findUnique({
    where: { reference: 'ESK-10484' },
    include: { payments: true, agreements: true },
  });
  if (awaiting && awaiting.status === BookingStatus.AWAITING_PAYMENT) {
    const agreement = awaiting.agreements.find((a) => a.counterpartyId === awaiting.customerId);
    if (agreement && agreement.status === AgreementStatus.AWAITING_UPLOAD && agreement.documentKey) {
      await prisma.agreement.update({
        where: { id: agreement.id },
        data: {
          status: AgreementStatus.UNDER_REVIEW,
          scannedCopyKey: agreement.documentKey,
          scannedCopyName: 'signed-agreement-scan.pdf',
          scannedCopyMimeType: 'application/pdf',
          uploadedAt: daysFromNow(-0.2),
          uploadedById: awaiting.customerId,
          signerName: 'Seeded Signer',
        },
      });
    }
    if (awaiting.payments.length === 0) {
      const receipt = await prisma.payment.findFirst({ where: { status: PaymentStatus.VERIFIED } });
      const account = await prisma.collectionAccount.findFirst({ where: { channel: AccountChannel.BANK } });
      const rows = await prisma.$queryRaw<{ lastValue: number }[]>`
        INSERT INTO "NumberSequence" ("id", "scope", "period", "lastValue", "updatedAt")
        VALUES (gen_random_uuid(), 'payment', 'all', 1, now())
        ON CONFLICT ("scope", "period")
        DO UPDATE SET "lastValue" = "NumberSequence"."lastValue" + 1, "updatedAt" = now()
        RETURNING "lastValue"`;
      await prisma.payment.create({
        data: {
          reference: `PAY-${String(rows[0].lastValue).padStart(4, '0')}`,
          bookingId: awaiting.id,
          collectionAccountId: account?.id,
          method: PaymentMethod.BANK_TRANSFER,
          transactionReference: 'FT26271SEED42',
          amountMinor: awaiting.totalMinor + awaiting.securityDepositMinor,
          receiptFileKey: receipt?.receiptFileKey ?? `bookings/${awaiting.reference}/receipts/payment.txt`,
          receiptFileName: 'cbe-transfer.pdf',
          receiptMimeType: 'application/pdf',
          status: PaymentStatus.SUBMITTED,
          submittedAt: daysFromNow(-0.1),
        },
      });
    }
  }

  // Issues on the desk: a client ↔ talent dispute and an equipment report.
  if ((await prisma.incident.count({ where: { reference: { startsWith: 'ESK-INC-9' } } })) === 0) {
    const engagement = await prisma.booking.findUnique({ where: { reference: 'ESK-TLT-9001' } });
    const rental = await prisma.booking.findUnique({ where: { reference: 'ESK-10485' } });
    if (engagement) {
      await prisma.incident.create({
        data: {
          reference: 'ESK-INC-90001',
          bookingId: engagement.id,
          reportedById: engagement.customerId,
          reporterRole: Role.CUSTOMER,
          type: IncidentType.LATE_ARRIVAL,
          phase: IncidentPhase.DURING_ENGAGEMENT,
          description: 'The cinematographer arrived 90 minutes after the agreed 08:00 call time.',
          status: IncidentStatus.REPORTED,
        },
      });
    }
    if (engagement?.talentProfileId) {
      const talent = await prisma.talentProfile.findUniqueOrThrow({ where: { id: engagement.talentProfileId } });
      await prisma.incident.create({
        data: {
          reference: 'ESK-INC-90002',
          bookingId: engagement.id,
          reportedById: talent.userId,
          reporterRole: Role.TALENT,
          type: IncidentType.OVERTIME,
          phase: IncidentPhase.DURING_ENGAGEMENT,
          description: 'The shoot ran three hours past the agreed 18:00 finish.',
          status: IncidentStatus.UNDER_REVIEW,
        },
      });
    }
    if (rental) {
      await prisma.incident.create({
        data: {
          reference: 'ESK-INC-90003',
          bookingId: rental.id,
          reportedById: rental.customerId,
          reporterRole: Role.CUSTOMER,
          type: IncidentType.TECHNICAL_MALFUNCTION,
          phase: IncidentPhase.DURING_RENTAL,
          description: 'The second battery will not hold a charge past 20 minutes.',
          status: IncidentStatus.REPORTED,
        },
      });
    }
  }

  // An overdue payout, so the Overdue chip has a row: the paid vendor settlement stays paid,
  // so mark an unpaid one's due date in the past if there is one.
  await prisma.settlement.updateMany({
    where: { status: 'PENDING', expectedAt: { gt: new Date() }, payeeKind: 'VENDOR' },
    data: { expectedAt: daysFromNow(-2) },
  });
}
