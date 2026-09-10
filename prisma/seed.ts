/**
 * Demo seed for Eskista.
 *
 * Produces a walkable dataset: verified vendors with published equipment, talent
 * profiles, and bookings spread across the lifecycle so every screen has something real
 * to render — including a paid settlement batch and a signed agreement.
 *
 * Idempotent: safe to re-run. Everything is upserted on a natural key, and demo
 * bookings are cleared first so counts do not multiply.
 *
 * Run with:  pnpm db:seed
 */
import {
  AgreementStatus,
  AgreementType,
  BookingStatus,
  BookingType,
  CategoryKind,
  CollectionMethod,
  ConditionGrade,
  DocumentStatus,
  ExperienceLevel,
  IncludedItemKind,
  InvoiceStatus,
  ListingStatus,
  PayeeKind,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  PricingModel,
  RentalPeriodUnit,
  ReviewKind,
  Role,
  SettlementStatus,
  SupplierDocumentType,
  SupplierResponse,
  UnitStatus,
  VendorKind,
  VendorType,
  VerificationStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_COMMISSION_BPS = 1500; // 15%
const CURRENCY = 'ETB';

/** ETB major → minor units. */
const etb = (major: number): number => Math.round(major * 100);

const daysFromNow = (days: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

const inclusiveDays = (start: Date, end: Date): number =>
  Math.max(Math.round((end.getTime() - start.getTime()) / 86_400_000), 1);

// ── Reference data ───────────────────────────────────────────────────────────

const EQUIPMENT_CATEGORIES = [
  { slug: 'cameras', name: 'Cameras' },
  { slug: 'lenses', name: 'Lenses' },
  { slug: 'lighting', name: 'Lighting' },
  { slug: 'audio', name: 'Audio' },
  { slug: 'grip-support', name: 'Grip & Support' },
  { slug: 'drones', name: 'Drones' },
  { slug: 'bundles', name: 'Bundles' },
];

const TALENT_CATEGORIES = [
  { slug: 'cinematographers', name: 'Cinematographers' },
  { slug: 'photographers', name: 'Photographers' },
  { slug: 'editors', name: 'Editors' },
  { slug: 'directors', name: 'Directors' },
  { slug: 'sound-engineers', name: 'Sound Engineers' },
  { slug: 'models-actors', name: 'Models & Actors' },
];

interface SeedUser {
  key: string;
  name: string;
  email: string;
  phone: string;
  telegramUserId: string;
  roles: Role[];
  activeRole: Role;
}

const USERS: SeedUser[] = [
  {
    key: 'admin',
    name: 'Eskista Operations',
    email: 'ops@eskista.et',
    phone: '+251911000001',
    telegramUserId: '900000001',
    roles: [Role.ADMIN],
    activeRole: Role.ADMIN,
  },
  {
    key: 'vendorAfro',
    name: 'Shebelaw Bogale',
    email: 'hello@afrostudio.et',
    phone: '+251911000002',
    telegramUserId: '900000002',
    roles: [Role.CUSTOMER, Role.VENDOR],
    activeRole: Role.VENDOR,
  },
  {
    key: 'vendorAddis',
    name: 'Meaza Tesfaye',
    email: 'rentals@addislens.et',
    phone: '+251911000003',
    telegramUserId: '900000003',
    roles: [Role.CUSTOMER, Role.VENDOR],
    activeRole: Role.VENDOR,
  },
  {
    key: 'customerHabesha',
    name: 'Yoseph Alemu',
    email: 'yoseph@habeshafilms.et',
    phone: '+251911000004',
    telegramUserId: '900000004',
    roles: [Role.CUSTOMER],
    activeRole: Role.CUSTOMER,
  },
  {
    key: 'customerSkyline',
    name: 'Selam Girma',
    email: 'selam@skylineevents.et',
    phone: '+251911000005',
    telegramUserId: '900000005',
    roles: [Role.CUSTOMER],
    activeRole: Role.CUSTOMER,
  },
  {
    key: 'talentDawit',
    name: 'Dawit Haile',
    email: 'dawit@eskista-talent.et',
    phone: '+251911000006',
    telegramUserId: '900000006',
    roles: [Role.CUSTOMER, Role.TALENT],
    activeRole: Role.TALENT,
  },
];

async function seedUsers(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, phone: u.phone, activeRole: u.activeRole },
      create: {
        name: u.name,
        email: u.email,
        emailVerified: true,
        phone: u.phone,
        telegramUserId: u.telegramUserId,
        activeRole: u.activeRole,
        languageCode: 'en',
      },
    });
    ids.set(u.key, user.id);

    for (const role of u.roles) {
      await prisma.roleMembership.upsert({
        where: { userId_role: { userId: user.id, role } },
        update: {},
        create: { userId: user.id, role },
      });
    }

    // Link a Telegram account row so the Mini App sign-in path finds these users.
    await prisma.account.upsert({
      where: { providerId_accountId: { providerId: 'telegram', accountId: u.telegramUserId } },
      update: {},
      create: { userId: user.id, providerId: 'telegram', accountId: u.telegramUserId },
    });
  }

  return ids;
}

async function seedCategories(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const [i, c] of EQUIPMENT_CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, sortOrder: i },
      create: { ...c, kind: CategoryKind.EQUIPMENT, sortOrder: i, isActive: true },
    });
    ids.set(c.slug, row.id);
  }
  for (const [i, c] of TALENT_CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, sortOrder: i },
      create: { ...c, kind: CategoryKind.TALENT, sortOrder: i, isActive: true },
    });
    ids.set(c.slug, row.id);
  }

  return ids;
}

async function seedPlatformSettings(): Promise<void> {
  const settings: { key: string; value: unknown; description: string }[] = [
    {
      key: 'commission.default_bps',
      value: DEFAULT_COMMISSION_BPS,
      description: 'Default Eskista commission in basis points (1500 = 15%).',
    },
    {
      key: 'delivery.flat_fee_minor',
      value: etb(500),
      description: 'Flat delivery fee inside Addis Ababa, in minor units.',
    },
    {
      key: 'tax.vat_bps',
      value: 0,
      description: 'VAT in basis points. Left at 0 until the client confirms treatment.',
    },
    {
      key: 'payment.accounts',
      value: {
        telebirr: { number: '0911234567', accountName: 'Eskista Equipment Rentals' },
        bank: {
          bank: 'CBE',
          accountName: 'Eskista Marketplace PLC',
          accountNumber: '1000234567890 1',
        },
      },
      description: 'Offline payment destinations shown on the payment screen.',
    },
    {
      key: 'return.slot_times',
      value: ['09:00', '10:00', '14:00', '16:00'],
      description: 'Selectable return drop-off times.',
    },
  ];

  for (const s of settings) {
    await prisma.platformSetting.upsert({
      where: { key: s.key },
      update: { value: s.value as never, description: s.description },
      create: { key: s.key, value: s.value as never, description: s.description },
    });
  }
}

async function seedAgreementTemplates(): Promise<string> {
  const template = await prisma.agreementTemplate.upsert({
    where: { key_version: { key: 'equipment-rental', version: 1 } },
    update: { isActive: true },
    create: {
      key: 'equipment-rental',
      kind: AgreementType.EQUIPMENT_RENTAL,
      version: 1,
      title: 'Eskista Equipment Rental Agreement',
      isActive: true,
      bodyMarkdown: [
        '# Equipment Rental Agreement',
        '',
        'This agreement is between **Eskista Marketplace PLC** ("Eskista"), acting on',
        'behalf of the equipment owner, and the customer named below ("Renter").',
        '',
        '## 1. Rental period',
        'The Renter may use the equipment from {{startDate}} to {{endDate}} inclusive.',
        '',
        '## 2. Charges',
        'Rental: {{subtotal}}. Delivery: {{deliveryFee}}. Security deposit: {{deposit}}.',
        'Total payable: **{{total}}**.',
        '',
        '## 3. Condition and return',
        'The Renter receives the equipment in the stated condition and returns it in the',
        'same condition, with all included items, by {{dueAt}}. Equipment is inspected on',
        'receipt. Damage or missing items are deducted from the security deposit, and any',
        'shortfall remains payable.',
        '',
        '## 4. Liability',
        'The Renter is liable for loss or damage up to the declared replacement value.',
        '',
        '## 5. Late return',
        'Late returns are charged at the daily rate for each additional day.',
        '',
        'Signed by {{signerName}} on {{signedAt}}.',
      ].join('\n'),
    },
  });

  await prisma.agreementTemplate.upsert({
    where: { key_version: { key: 'talent-engagement', version: 1 } },
    update: { isActive: true },
    create: {
      key: 'talent-engagement',
      kind: AgreementType.TALENT_ENGAGEMENT,
      version: 1,
      title: 'Eskista Talent Engagement Agreement',
      isActive: true,
      bodyMarkdown: [
        '# Talent Engagement Agreement',
        '',
        'Engagement of {{talentName}} by {{clientName}} for {{eventLocation}} on',
        '{{startDate}}. Agreed fee: **{{total}}**, coordinated and collected by Eskista.',
        '',
        'Cancellation within 48 hours of the engagement date forfeits 50% of the fee.',
      ].join('\n'),
    },
  });

  return template.id;
}

// ── Suppliers ────────────────────────────────────────────────────────────────

async function seedVendors(userIds: Map<string, string>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  const vendors = [
    {
      key: 'afro',
      userKey: 'vendorAfro',
      businessName: 'Afro Studio',
      kind: VendorKind.COMPANY,
      vendorType: VendorType.CREATIVE_STUDIO,
      email: 'hello@afrostudio.et',
      phone: '+251911000002',
      location: 'Bole, Addis Ababa',
      about: 'Full-service creative studio renting cinema cameras and lighting since 2019.',
    },
    {
      key: 'addis',
      userKey: 'vendorAddis',
      businessName: 'Addis Lens Co.',
      kind: VendorKind.COMPANY,
      vendorType: VendorType.RENTAL_COMPANY,
      email: 'rentals@addislens.et',
      phone: '+251911000003',
      location: 'Kazanchis, Addis Ababa',
      about: 'Cine glass and camera bodies for commercial and documentary crews.',
    },
  ];

  for (const v of vendors) {
    const userId = userIds.get(v.userKey)!;
    const vendor = await prisma.vendorProfile.upsert({
      where: { userId },
      update: { status: VerificationStatus.VERIFIED },
      create: {
        userId,
        businessName: v.businessName,
        kind: v.kind,
        vendorType: v.vendorType,
        email: v.email,
        phone: v.phone,
        location: v.location,
        about: v.about,
        status: VerificationStatus.VERIFIED,
        verifiedAt: daysFromNow(-40),
        verifiedByAdminId: userIds.get('admin')!,
        commissionRateBps: DEFAULT_COMMISSION_BPS,
      },
    });
    ids.set(v.key, vendor.id);

    // Verified KYC set: Fayda ID + business registration + signed rental agreement.
    const docs: SupplierDocumentType[] = [
      SupplierDocumentType.FAYDA_ID,
      SupplierDocumentType.BUSINESS_REGISTRATION,
      SupplierDocumentType.RENTAL_AGREEMENT,
    ];
    for (const type of docs) {
      const existing = await prisma.supplierDocument.findFirst({
        where: { vendorId: vendor.id, type },
      });
      if (!existing) {
        await prisma.supplierDocument.create({
          data: {
            vendorId: vendor.id,
            type,
            fileKey: `seed/vendors/${vendor.id}/${type.toLowerCase()}.pdf`,
            fileName: `${type.toLowerCase()}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 248_000,
            status: DocumentStatus.VERIFIED,
            reviewedAt: daysFromNow(-40),
            reviewedById: userIds.get('admin')!,
          },
        });
      }
    }
  }

  return ids;
}

async function seedTalent(
  userIds: Map<string, string>,
  categoryIds: Map<string, string>,
): Promise<string> {
  const userId = userIds.get('talentDawit')!;

  const talent = await prisma.talentProfile.upsert({
    where: { userId },
    update: { status: VerificationStatus.VERIFIED },
    create: {
      userId,
      displayName: 'Dawit Haile',
      headline: 'Cinematographer · commercials & documentary',
      bio: 'Ten years shooting commercials, music videos and long-form documentary across Ethiopia and East Africa. Owner-operator on FX9 and Alexa Mini.',
      location: 'Addis Ababa',
      experienceLevel: ExperienceLevel.SENIOR,
      yearsExperience: 10,
      specializations: ['Commercials', 'Documentary', 'Music video', 'Aerial'],
      languages: ['Amharic', 'English'],
      pricingModel: PricingModel.PER_DAY,
      baseRateMinor: etb(12_000),
      currency: CURRENCY,
      isAvailableForHire: true,
      status: VerificationStatus.VERIFIED,
      verifiedAt: daysFromNow(-25),
      verifiedByAdminId: userIds.get('admin')!,
      commissionRateBps: DEFAULT_COMMISSION_BPS,
      ratingAvg: 4.8,
      ratingCount: 12,
      completedBookings: 12,
    },
  });

  const services = [
    {
      title: 'Commercial DOP — full day',
      description: 'Director of photography for a full 10-hour commercial shoot day.',
      priceMinor: etb(12_000),
    },
    {
      title: 'Documentary shooter — day rate',
      description: 'Owner-operator documentary shooting, including basic sound.',
      priceMinor: etb(9_000),
    },
  ];

  for (const [i, s] of services.entries()) {
    const existing = await prisma.talentService.findFirst({
      where: { talentProfileId: talent.id, title: s.title },
    });
    if (!existing) {
      await prisma.talentService.create({
        data: {
          talentProfileId: talent.id,
          categoryId: categoryIds.get('cinematographers')!,
          title: s.title,
          description: s.description,
          pricingModel: PricingModel.PER_DAY,
          priceMinor: s.priceMinor,
          currency: CURRENCY,
          sortOrder: i,
        },
      });
    }
  }

  const portfolio = [
    { title: 'Dashen Beer — "Yene Ethiopia"', externalUrl: 'https://example.com/dashen' },
    { title: 'Lalibela documentary (2025)', externalUrl: 'https://example.com/lalibela' },
  ];
  for (const [i, p] of portfolio.entries()) {
    const existing = await prisma.portfolioItem.findFirst({
      where: { talentProfileId: talent.id, title: p.title },
    });
    if (!existing) {
      await prisma.portfolioItem.create({
        data: { talentProfileId: talent.id, ...p, sortOrder: i },
      });
    }
  }

  return talent.id;
}

// ── Equipment ────────────────────────────────────────────────────────────────

interface SeedListing {
  key: string;
  vendorKey: string;
  categorySlug: string;
  name: string;
  brand: string;
  model: string;
  mainSpecification: string;
  compatibility: string[];
  powerBattery: string;
  description: string;
  priceMajor: number;
  depositMajor: number;
  replacementMajor: number;
  units: number;
  isFeatured: boolean;
  specs: { group?: string; label: string; value: string }[];
  included: { kind: IncludedItemKind; name: string; quantity: number }[];
}

const LISTINGS: SeedListing[] = [
  {
    key: 'fx3',
    vendorKey: 'afro',
    categorySlug: 'cameras',
    name: 'Sony FX3 Cinema Camera',
    brand: 'Sony',
    model: 'ILME-FX3',
    mainSpecification: 'Full-frame 10.2MP CMOS · 4K120 10-bit 4:2:2 · dual base ISO',
    compatibility: ['E-mount', 'EF via adapter', 'PL via adapter'],
    powerBattery: '2x NP-FZ100 supplied · USB-C PD in · D-Tap with optional plate',
    description:
      'Compact full-frame cinema camera built for run-and-gun and small-crew commercial work. Includes cage, XLR handle and media.',
    priceMajor: 3_000,
    depositMajor: 20_000,
    replacementMajor: 240_000,
    units: 2,
    isFeatured: true,
    specs: [
      { group: 'Sensor', label: 'Type', value: '35mm full-frame Exmor R CMOS' },
      { group: 'Sensor', label: 'Effective pixels', value: '10.2 MP' },
      { group: 'Recording', label: 'Max frame rate', value: '4K 120fps' },
      { group: 'Recording', label: 'Codec', value: 'XAVC S-I, XAVC HS' },
      { group: 'Recording', label: 'Bit depth', value: '10-bit 4:2:2' },
      { group: 'Media', label: 'Card slots', value: '2x CFexpress Type A / SD' },
      { group: 'Audio', label: 'Inputs', value: '2x XLR via handle, 3.5mm' },
      { group: 'Body', label: 'Weight', value: '715 g (body only)' },
    ],
    included: [
      { kind: IncludedItemKind.EQUIPMENT, name: 'Sony FX3 camera body', quantity: 1 },
      { kind: IncludedItemKind.EQUIPMENT, name: 'XLR handle unit', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'NP-FZ100 battery', quantity: 2 },
      { kind: IncludedItemKind.ACCESSORY, name: 'Battery charger', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: '160GB CFexpress Type A card', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'Camera cage', quantity: 1 },
    ],
  },
  {
    key: 'sigma2470',
    vendorKey: 'addis',
    categorySlug: 'lenses',
    name: 'Sigma 24-70mm f/2.8 DG DN Art',
    brand: 'Sigma',
    model: '24-70 DG DN Art',
    mainSpecification: 'Constant f/2.8 standard zoom · weather sealed · 82mm filter',
    compatibility: ['E-mount', 'L-mount'],
    powerBattery: 'No power required',
    description:
      'Versatile standard zoom with constant f/2.8 aperture. A workhorse lens for events, portraits and run-and-gun production.',
    priceMajor: 900,
    depositMajor: 6_000,
    replacementMajor: 78_000,
    units: 3,
    isFeatured: true,
    specs: [
      { group: 'Optics', label: 'Focal length', value: '24-70mm' },
      { group: 'Optics', label: 'Max aperture', value: 'f/2.8' },
      { group: 'Optics', label: 'Min aperture', value: 'f/22' },
      { group: 'Optics', label: 'Elements/groups', value: '19 elements in 15 groups' },
      { group: 'Physical', label: 'Filter thread', value: '82 mm' },
      { group: 'Physical', label: 'Weather sealing', value: 'Yes' },
      { group: 'Physical', label: 'Weight', value: '835 g' },
    ],
    included: [
      { kind: IncludedItemKind.EQUIPMENT, name: 'Sigma 24-70mm f/2.8 lens', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'Front and rear caps', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'Petal lens hood', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'Padded lens pouch', quantity: 1 },
    ],
  },
  {
    key: 'aputure300d',
    vendorKey: 'afro',
    categorySlug: 'lighting',
    name: 'Aputure LS 300d II LED Light Kit',
    brand: 'Aputure',
    model: 'LS 300d II',
    mainSpecification: '350W daylight COB · 5500K · Bowens mount',
    compatibility: ['Bowens mount modifiers'],
    powerBattery: 'AC mains, or 2x V-mount (not included)',
    description:
      'Punchy daylight-balanced COB fixture with reflector and softbox. The default key light for interviews and small sets.',
    priceMajor: 1_200,
    depositMajor: 8_000,
    replacementMajor: 96_000,
    units: 4,
    isFeatured: false,
    specs: [
      { group: 'Output', label: 'Power draw', value: '350 W' },
      { group: 'Output', label: 'Colour temperature', value: '5500 K ± 200 K' },
      { group: 'Output', label: 'CRI / TLCI', value: '≥ 95 / ≥ 96' },
      { group: 'Mount', label: 'Accessory mount', value: 'Bowens' },
      { group: 'Control', label: 'Dimming', value: '0-100% via Sidus Link / DMX' },
    ],
    included: [
      { kind: IncludedItemKind.EQUIPMENT, name: 'LS 300d II light head', quantity: 1 },
      { kind: IncludedItemKind.EQUIPMENT, name: 'Control ballast', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'Hyper reflector', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'Light dome mini II softbox', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'C-stand', quantity: 1 },
    ],
  },
  {
    key: 'mavic3',
    vendorKey: 'addis',
    categorySlug: 'drones',
    name: 'DJI Mavic 3 Cine',
    brand: 'DJI',
    model: 'Mavic 3 Cine',
    mainSpecification: '4/3 CMOS Hasselblad · Apple ProRes 422 HQ · 43 min flight',
    compatibility: ['DJI RC Pro'],
    powerBattery: '3x intelligent flight batteries · 100W charging hub',
    description:
      'Cine-spec drone with 4/3 Hasselblad sensor and internal ProRes recording. Permit support available on request.',
    priceMajor: 2_200,
    depositMajor: 25_000,
    replacementMajor: 290_000,
    units: 1,
    isFeatured: false,
    specs: [
      { group: 'Camera', label: 'Sensor', value: '4/3 CMOS Hasselblad' },
      { group: 'Camera', label: 'Codec', value: 'Apple ProRes 422 HQ' },
      { group: 'Camera', label: 'Tele camera', value: '1/2" CMOS, 28x hybrid zoom' },
      { group: 'Flight', label: 'Max flight time', value: '43 minutes' },
      { group: 'Flight', label: 'Transmission', value: 'O3+, up to 15 km' },
      { group: 'Storage', label: 'Internal', value: '1 TB SSD' },
    ],
    included: [
      { kind: IncludedItemKind.EQUIPMENT, name: 'Mavic 3 Cine aircraft', quantity: 1 },
      { kind: IncludedItemKind.EQUIPMENT, name: 'DJI RC Pro controller', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'Intelligent flight battery', quantity: 3 },
      { kind: IncludedItemKind.ACCESSORY, name: '100W charging hub', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'ND filter set', quantity: 1 },
    ],
  },
  {
    key: 'rode-kit',
    vendorKey: 'afro',
    categorySlug: 'audio',
    name: 'Sennheiser MKE 600 + Zoom F6 Sound Kit',
    brand: 'Sennheiser',
    model: 'MKE 600 / F6',
    mainSpecification: 'Supercardioid shotgun · 6-input 32-bit float recorder',
    compatibility: ['XLR', 'Timecode via BNC'],
    powerBattery: '4x AA in recorder · phantom power supplied',
    description:
      'Location sound package: shotgun mic, boom pole, blimp and a 32-bit float multitrack recorder.',
    priceMajor: 800,
    depositMajor: 5_000,
    replacementMajor: 62_000,
    units: 2,
    isFeatured: false,
    specs: [
      { group: 'Microphone', label: 'Polar pattern', value: 'Supercardioid' },
      { group: 'Microphone', label: 'Frequency response', value: '40 Hz - 20 kHz' },
      { group: 'Recorder', label: 'Inputs', value: '6x XLR/TRS combo' },
      { group: 'Recorder', label: 'Bit depth', value: '32-bit float' },
    ],
    included: [
      { kind: IncludedItemKind.EQUIPMENT, name: 'Sennheiser MKE 600 shotgun mic', quantity: 1 },
      { kind: IncludedItemKind.EQUIPMENT, name: 'Zoom F6 field recorder', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'Boom pole', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'Rycote blimp and windjammer', quantity: 1 },
      { kind: IncludedItemKind.ACCESSORY, name: 'XLR cable', quantity: 3 },
    ],
  },
];

async function seedListings(
  vendorIds: Map<string, string>,
  categoryIds: Map<string, string>,
  adminId: string,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const l of LISTINGS) {
    const vendorId = vendorIds.get(l.vendorKey)!;
    const slug = l.key;

    const listing = await prisma.listing.upsert({
      where: { slug },
      update: { status: ListingStatus.PUBLISHED },
      create: {
        slug,
        vendorId,
        categoryId: categoryIds.get(l.categorySlug)!,
        name: l.name,
        brand: l.brand,
        model: l.model,
        mainSpecification: l.mainSpecification,
        compatibility: l.compatibility,
        powerBattery: l.powerBattery,
        condition: ConditionGrade.EXCELLENT,
        conditionNotes: 'Serviced and cleaned between every rental.',
        description: l.description,
        location: 'Addis Ababa',
        rentalPriceMinor: etb(l.priceMajor),
        rentalPeriodUnit: RentalPeriodUnit.DAY,
        minRentalPeriods: 1,
        securityDepositMinor: etb(l.depositMajor),
        replacementValueMinor: etb(l.replacementMajor),
        rentalRequirements: 'Valid Fayda ID, refundable security deposit.',
        currency: CURRENCY,
        status: ListingStatus.PUBLISHED,
        submittedAt: daysFromNow(-35),
        publishedAt: daysFromNow(-34),
        reviewedById: adminId,
        isFeatured: l.isFeatured,
      },
    });
    ids.set(l.key, listing.id);

    // Replace child collections so re-running the seed does not duplicate them.
    await prisma.listingSpec.deleteMany({ where: { listingId: listing.id } });
    await prisma.listingSpec.createMany({
      data: l.specs.map((s, i) => ({ listingId: listing.id, ...s, sortOrder: i })),
    });

    await prisma.listingIncludedItem.deleteMany({ where: { listingId: listing.id } });
    await prisma.listingIncludedItem.createMany({
      data: l.included.map((item, i) => ({ listingId: listing.id, ...item, sortOrder: i })),
    });

    await prisma.listingImage.deleteMany({ where: { listingId: listing.id } });
    await prisma.listingImage.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({
        listingId: listing.id,
        fileKey: `seed/listings/${slug}/${i + 1}.jpg`,
        altText: `${l.name} — photo ${i + 1}`,
        isPrimary: i === 0,
        sortOrder: i,
      })),
    });

    const existingUnits = await prisma.equipmentUnit.count({ where: { listingId: listing.id } });
    if (existingUnits === 0) {
      await prisma.equipmentUnit.createMany({
        data: Array.from({ length: l.units }, (_, i) => ({
          listingId: listing.id,
          label: `${l.brand} ${l.model} #${i + 1}`,
          serialNumber: `${slug.toUpperCase()}-${String(i + 1).padStart(4, '0')}`,
          condition: ConditionGrade.EXCELLENT,
          status: UnitStatus.AVAILABLE,
          acquiredAt: daysFromNow(-200),
        })),
      });
    }
  }

  // Related accessories: the lens and light are suggested alongside the camera.
  const fx3 = ids.get('fx3')!;
  await prisma.listingAccessory.deleteMany({ where: { listingId: fx3 } });
  await prisma.listingAccessory.createMany({
    data: [
      { listingId: fx3, accessoryId: ids.get('sigma2470')!, sortOrder: 0 },
      { listingId: fx3, accessoryId: ids.get('aputure300d')!, sortOrder: 1 },
      { listingId: fx3, accessoryId: ids.get('rode-kit')!, sortOrder: 2 },
    ],
  });

  return ids;
}

// ── Bookings across the lifecycle ────────────────────────────────────────────

interface BookingPlan {
  ref: string;
  listingKey: string;
  vendorKey: string;
  customerKey: string;
  status: BookingStatus;
  supplierResponse: SupplierResponse;
  startOffset: number;
  endOffset: number;
  quantity: number;
  collectionMethod: CollectionMethod;
  purpose: string;
  withPayment?: boolean;
  withInvoice?: boolean;
  withAgreement?: boolean;
  withSettlement?: SettlementStatus;
  withReviews?: boolean;
}

const BOOKING_PLANS: BookingPlan[] = [
  {
    ref: 'ESK-10482',
    listingKey: 'fx3',
    vendorKey: 'afro',
    customerKey: 'customerHabesha',
    status: BookingStatus.REQUEST_SUBMITTED,
    supplierResponse: SupplierResponse.PENDING,
    startOffset: 6,
    endOffset: 9,
    quantity: 1,
    collectionMethod: CollectionMethod.DELIVERY,
    purpose: 'Corporate promotional video production.',
  },
  {
    ref: 'ESK-10483',
    listingKey: 'sigma2470',
    vendorKey: 'addis',
    customerKey: 'customerSkyline',
    status: BookingStatus.ESKISTA_REVIEW,
    supplierResponse: SupplierResponse.ACCEPTED,
    startOffset: 10,
    endOffset: 12,
    quantity: 2,
    collectionMethod: CollectionMethod.PICKUP,
    purpose: 'Studio interview shoot.',
  },
  {
    ref: 'ESK-10484',
    listingKey: 'aputure300d',
    vendorKey: 'afro',
    customerKey: 'customerHabesha',
    status: BookingStatus.AWAITING_PAYMENT,
    supplierResponse: SupplierResponse.ACCEPTED,
    startOffset: 4,
    endOffset: 6,
    quantity: 2,
    collectionMethod: CollectionMethod.DELIVERY,
    purpose: 'NGO field documentary lighting.',
    withInvoice: true,
    withAgreement: true,
  },
  {
    ref: 'ESK-10485',
    listingKey: 'fx3',
    vendorKey: 'afro',
    customerKey: 'customerSkyline',
    status: BookingStatus.IN_PROGRESS,
    supplierResponse: SupplierResponse.ACCEPTED,
    startOffset: -2,
    endOffset: 2,
    quantity: 1,
    collectionMethod: CollectionMethod.DELIVERY,
    purpose: 'Music video, two-day shoot in Addis.',
    withPayment: true,
    withInvoice: true,
    withAgreement: true,
  },
  {
    ref: 'ESK-10486',
    listingKey: 'mavic3',
    vendorKey: 'addis',
    customerKey: 'customerHabesha',
    status: BookingStatus.CLOSED,
    supplierResponse: SupplierResponse.ACCEPTED,
    startOffset: -20,
    endOffset: -17,
    quantity: 1,
    collectionMethod: CollectionMethod.PICKUP,
    purpose: 'Aerial coverage for a tourism campaign.',
    withPayment: true,
    withInvoice: true,
    withAgreement: true,
    withSettlement: SettlementStatus.PAID,
    withReviews: true,
  },
  {
    ref: 'ESK-10487',
    listingKey: 'rode-kit',
    vendorKey: 'afro',
    customerKey: 'customerSkyline',
    status: BookingStatus.CLOSED,
    supplierResponse: SupplierResponse.ACCEPTED,
    startOffset: -12,
    endOffset: -10,
    quantity: 1,
    collectionMethod: CollectionMethod.DELIVERY,
    purpose: 'Podcast recording series.',
    withPayment: true,
    withInvoice: true,
    withSettlement: SettlementStatus.PAID,
    withReviews: true,
  },
];

async function seedBookings(
  userIds: Map<string, string>,
  vendorIds: Map<string, string>,
  listingIds: Map<string, string>,
  templateId: string,
): Promise<void> {
  const adminId = userIds.get('admin')!;
  const refs = BOOKING_PLANS.map((p) => p.ref);

  // Clear demo bookings so re-running does not double the dashboard counts.
  await prisma.booking.deleteMany({ where: { reference: { in: refs } } });

  let invoiceCounter = 140;

  for (const plan of BOOKING_PLANS) {
    const listingId = listingIds.get(plan.listingKey)!;
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });

    const startDate = daysFromNow(plan.startOffset);
    const endDate = daysFromNow(plan.endOffset);
    const periods = inclusiveDays(startDate, endDate);

    const subtotal = listing.rentalPriceMinor * periods * plan.quantity;
    const deliveryFee = plan.collectionMethod === CollectionMethod.DELIVERY ? etb(500) : 0;
    const deposit = (listing.securityDepositMinor ?? 0) * plan.quantity;
    const commission = Math.round((subtotal * DEFAULT_COMMISSION_BPS) / 10_000);
    const total = subtotal + deliveryFee + deposit;

    const dueAt = new Date(endDate);
    dueAt.setUTCHours(17, 0, 0, 0);

    const booking = await prisma.booking.create({
      data: {
        reference: plan.ref,
        type: BookingType.EQUIPMENT,
        customerId: userIds.get(plan.customerKey)!,
        vendorId: vendorIds.get(plan.vendorKey)!,
        listingId,
        startDate,
        endDate,
        periods,
        contactPhone: '+251911234567',
        additionalPhone: '+251911765432',
        projectDescription: plan.purpose,
        status: plan.status,
        supplierResponse: plan.supplierResponse,
        supplierRespondedAt:
          plan.supplierResponse === SupplierResponse.PENDING ? null : daysFromNow(-1),
        approvedById: plan.withInvoice ? adminId : null,
        approvedAt: plan.withInvoice ? daysFromNow(-1) : null,
        currency: CURRENCY,
        unitPriceMinor: listing.rentalPriceMinor,
        subtotalMinor: subtotal,
        deliveryFeeMinor: deliveryFee,
        securityDepositMinor: deposit,
        totalMinor: total,
        commissionRateBps: DEFAULT_COMMISSION_BPS,
        commissionMinor: commission,
        supplierEarningsMinor: subtotal - commission,
        pricedAt: daysFromNow(-1),
        dueAt,
        equipmentDetail: {
          create: {
            quantity: plan.quantity,
            collectionMethod: plan.collectionMethod,
            deliveryAddress:
              plan.collectionMethod === CollectionMethod.DELIVERY ? 'Bole, Addis Ababa' : null,
          },
        },
        statusEvents: {
          create: {
            toStatus: plan.status,
            actorId: adminId,
            actorRole: Role.ADMIN,
            reason: 'Seeded demo booking',
          },
        },
      },
    });

    // Assign units for anything that has progressed past approval.
    if (plan.withPayment || plan.withSettlement) {
      const units = await prisma.equipmentUnit.findMany({
        where: { listingId },
        take: plan.quantity,
      });
      if (units.length > 0) {
        await prisma.bookingUnit.createMany({
          data: units.map((u) => ({ bookingId: booking.id, unitId: u.id })),
        });
      }
    }

    if (plan.withInvoice) {
      invoiceCounter += 1;
      await prisma.invoice.create({
        data: {
          number: `ESK-INV-2026-${String(invoiceCounter).padStart(6, '0')}`,
          bookingId: booking.id,
          status: plan.withPayment ? InvoiceStatus.PAID : InvoiceStatus.ISSUED,
          currency: CURRENCY,
          subtotalMinor: subtotal,
          deliveryFeeMinor: deliveryFee,
          securityDepositMinor: deposit,
          totalMinor: total,
          amountPaidMinor: plan.withPayment ? total : 0,
          billedToName: (await prisma.user.findUniqueOrThrow({
            where: { id: userIds.get(plan.customerKey)! },
            select: { name: true },
          })).name,
          billedToPhone: '+251911234567',
          billedToAddress: 'Bole, Addis Ababa',
          issuedAt: daysFromNow(-1),
          dueAt: startDate,
          issuedById: adminId,
        },
      });
    }

    if (plan.withPayment) {
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          method: PaymentMethod.TELEBIRR,
          transactionReference: `TBR${Math.floor(Math.random() * 9_000_000 + 1_000_000)}XZ`,
          amountMinor: total,
          currency: CURRENCY,
          receiptFileKey: `seed/receipts/${plan.ref}.jpg`,
          receiptFileName: `${plan.ref}-receipt.jpg`,
          receiptMimeType: 'image/jpeg',
          receiptSizeBytes: 184_000,
          status: PaymentStatus.VERIFIED,
          verifiedAt: daysFromNow(-1),
          verifiedById: adminId,
        },
      });
    }

    if (plan.withAgreement) {
      await prisma.agreement.create({
        data: {
          bookingId: booking.id,
          templateId,
          kind: AgreementType.EQUIPMENT_RENTAL,
          version: 1,
          status: plan.withPayment ? AgreementStatus.SIGNED : AgreementStatus.SENT,
          documentKey: `seed/agreements/${plan.ref}.pdf`,
          contentHash: `sha256:seed-${plan.ref.toLowerCase()}`,
          sentAt: daysFromNow(-2),
          ...(plan.withPayment
            ? {
                signedAt: daysFromNow(-1),
                signedById: userIds.get(plan.customerKey)!,
                signerName: 'Seeded Signer',
                signerPhone: '+251911234567',
                signerIpAddress: '196.188.0.1',
              }
            : {}),
        },
      });
    }

    if (plan.withSettlement) {
      await prisma.settlement.create({
        data: {
          bookingId: booking.id,
          payeeKind: PayeeKind.VENDOR,
          vendorId: vendorIds.get(plan.vendorKey)!,
          grossMinor: subtotal,
          commissionMinor: commission,
          netMinor: subtotal - commission,
          currency: CURRENCY,
          status: plan.withSettlement,
          expectedAt: daysFromNow(-8),
          ...(plan.withSettlement === SettlementStatus.PAID
            ? { paidAt: daysFromNow(-6), paidById: adminId, payoutReference: 'CBE-TRF-88213' }
            : {}),
        },
      });
    }

    if (plan.withReviews) {
      // Both review types the client asked for, prompted at return.
      await prisma.review.create({
        data: {
          bookingId: booking.id,
          kind: ReviewKind.EQUIPMENT,
          authorId: userIds.get(plan.customerKey)!,
          listingId,
          vendorId: vendorIds.get(plan.vendorKey)!,
          rating: 5,
          comment: 'Gear was spotless and exactly as described. Batteries fully charged.',
        },
      });
      await prisma.review.create({
        data: {
          bookingId: booking.id,
          kind: ReviewKind.PLATFORM_SERVICE,
          authorId: userIds.get(plan.customerKey)!,
          rating: 4,
          comment: 'Eskista coordinated delivery well. Approval took about a day.',
        },
      });
    }
  }
}

/** One paid batch covering both closed bookings, to demo multi-booking settlement. */
async function seedSettlementBatch(userIds: Map<string, string>): Promise<void> {
  const settlements = await prisma.settlement.findMany({
    where: { status: SettlementStatus.PAID, batchId: null },
    include: { booking: { select: { reference: true } } },
  });
  if (settlements.length === 0) return;

  const byVendor = new Map<string, typeof settlements>();
  for (const s of settlements) {
    if (!s.vendorId) continue;
    const list = byVendor.get(s.vendorId) ?? [];
    list.push(s);
    byVendor.set(s.vendorId, list);
  }

  let counter = 0;
  for (const [vendorId, lines] of byVendor) {
    counter += 1;
    const reference = `ESK-STL-2026-09-${String(counter).padStart(4, '0')}`;

    await prisma.settlementBatch.deleteMany({ where: { reference } });

    const gross = lines.reduce((sum, l) => sum + l.grossMinor, 0);
    const commission = lines.reduce((sum, l) => sum + l.commissionMinor, 0);
    const net = lines.reduce((sum, l) => sum + l.netMinor, 0);

    const batch = await prisma.settlementBatch.create({
      data: {
        reference,
        payeeKind: PayeeKind.VENDOR,
        vendorId,
        periodStart: daysFromNow(-30),
        periodEnd: daysFromNow(-1),
        currency: CURRENCY,
        grossMinor: gross,
        commissionMinor: commission,
        netMinor: net,
        bookingCount: lines.length,
        status: SettlementStatus.PAID,
        paidAt: daysFromNow(-5),
        paidById: userIds.get('admin')!,
        payoutReference: `CBE-BATCH-${counter}`,
        notes: `Covers ${lines.map((l) => l.booking.reference).join(', ')}`,
      },
    });

    await prisma.settlement.updateMany({
      where: { id: { in: lines.map((l) => l.id) } },
      data: { batchId: batch.id },
    });
  }
}

/** Recomputes the denormalised rating aggregates from the seeded reviews. */
async function recomputeAggregates(): Promise<void> {
  const listings = await prisma.listing.findMany({ select: { id: true } });
  for (const { id } of listings) {
    const agg = await prisma.review.aggregate({
      where: { listingId: id, kind: ReviewKind.EQUIPMENT, isPublished: true },
      _avg: { rating: true },
      _count: { rating: true },
    });
    const bookingCount = await prisma.booking.count({ where: { listingId: id } });
    await prisma.listing.update({
      where: { id },
      data: {
        ratingAvg: agg._avg.rating ?? 0,
        ratingCount: agg._count.rating,
        bookingCount,
      },
    });
  }

  const vendors = await prisma.vendorProfile.findMany({ select: { id: true } });
  for (const { id } of vendors) {
    const agg = await prisma.review.aggregate({
      where: { vendorId: id, isPublished: true },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await prisma.vendorProfile.update({
      where: { id },
      data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count.rating },
    });
  }
}

async function main(): Promise<void> {
  console.log('Seeding Eskista demo data…');

  const userIds = await seedUsers();
  console.log(`  users:            ${userIds.size}`);

  const categoryIds = await seedCategories();
  console.log(`  categories:       ${categoryIds.size}`);

  await seedPlatformSettings();
  const templateId = await seedAgreementTemplates();
  console.log('  settings + agreement templates ✓');

  const vendorIds = await seedVendors(userIds);
  console.log(`  vendors:          ${vendorIds.size} (verified)`);

  const talentId = await seedTalent(userIds, categoryIds);
  console.log(`  talent:           1 (${talentId.slice(0, 8)}…)`);

  const listingIds = await seedListings(vendorIds, categoryIds, userIds.get('admin')!);
  console.log(`  listings:         ${listingIds.size} (published, with units + specs)`);

  await seedBookings(userIds, vendorIds, listingIds, templateId);
  console.log(`  bookings:         ${BOOKING_PLANS.length} across the lifecycle`);

  await seedSettlementBatch(userIds);
  await recomputeAggregates();
  console.log('  settlement batch + aggregates ✓');

  console.log('\nDone. Sign in as any seeded Telegram id, e.g. 900000002 (Afro Studio vendor).');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
