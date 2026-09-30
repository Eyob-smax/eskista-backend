import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminTier,
  DocumentStatus,
  Prisma,
  ReviewCheckState,
  Role,
  SupplierDocumentType,
  VerificationStatus,
} from '@prisma/client';
import {
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  UPLOAD_LIMITS,
  assertValidFile,
  type UploadedFile,
} from '../../common/upload';
import { TALENT_COMMITTED } from '../hiring/hiring.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage.interface';
import {
  BlockDatesDto,
  CreatePortfolioDto,
  CreateTalentProfileDto,
  PortfolioFieldsDto,
  PortfolioResponse,
  ReplaceEducationDto,
  ReplaceExperienceDto,
  ReplaceReferencesDto,
  SlugAvailabilityResponse,
  TalentAvailabilityResponse,
  TalentProfileResponse,
  TalentServiceDto,
  TalentServiceResponse,
  UpdateTalentProfileDto,
  UpdateTalentServiceDto,
} from './dto/talent-profile.dto';
import {
  MAX_PORTFOLIO,
  RESERVED_SLUGS,
  computeCompletion,
  normaliseSlug,
} from './talent-completion';
import { profileUrlFor, talentAvatarUrl } from './talent-media';

export const talentInclude = {
  user: { select: { image: true } },
  experiences: { orderBy: { sortOrder: 'asc' } },
  educations: { orderBy: { sortOrder: 'asc' } },
  references: { orderBy: { sortOrder: 'asc' } },
  portfolio: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  services: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  documents: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.TalentProfileInclude;

export type TalentWithSections = Prisma.TalentProfileGetPayload<{
  include: typeof talentInclude;
}>;

const IDENTITY_DOCUMENTS: SupplierDocumentType[] = [
  SupplierDocumentType.FAYDA_ID,
  SupplierDocumentType.PASSPORT,
];

/** Fields whose change on an approved profile needs Eskista to look again. */
const PRICE_FIELDS = ['baseRateMinor', 'pricingModel'] as const;

/**
 * A creative professional's own profile: the nine-screen onboarding wizard, and every edit
 * after it.
 *
 * Every section saves independently, so the wizard can stop after any step ("Save",
 * top-right) and pick up later. What submission needs is decided in one place,
 * `computeCompletion`, which also drives the progress bar and the dashboard's percentage.
 *
 * Talent is not listed until Eskista approves the profile. Approval is where the commission
 * is set, so the rate a talent enters is what they are paid; the customer sees it with
 * commission and VAT added.
 */
@Injectable()
export class TalentProfileService {
  private readonly logger = new Logger(TalentProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ── Onboarding ─────────────────────────────────────────────────────────────

  /**
   * Creates the profile and grants the TALENT role.
   *
   * Granted at creation, not at approval, for the same reason as vendors: the talent app
   * has to be reachable while the profile is a draft, or the talent cannot finish it. What
   * approval gates is being listed and hired, not using the app.
   */
  async onboard(userId: string, dto: CreateTalentProfileDto): Promise<TalentProfileResponse> {
    const existing = await this.prisma.talentProfile.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException('This account already has a talent profile');
    }
    if (dto.slug !== undefined) await this.assertSlugFree(dto.slug, null);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { phone: true, experienceChosenAt: true },
    });
    const slug = dto.slug ? normaliseSlug(dto.slug) : await this.suggestSlug(dto.displayName);

    await this.prisma.$transaction(async (tx) => {
      await tx.talentProfile.create({
        data: {
          userId,
          displayName: dto.displayName,
          location: dto.location,
          phone: dto.phone ?? user.phone,
          slug,
          ...this.profileFields(dto),
          termsAcceptedAt: dto.acceptTerms ? new Date() : null,
          status: VerificationStatus.DRAFT,
        },
      });
      await tx.roleMembership.upsert({
        where: { userId_role: { userId, role: Role.TALENT } },
        create: { userId, role: Role.TALENT },
        update: {},
      });
      // The user chose "Creative Professional" to get here; open the talent app for them.
      await tx.user.update({
        where: { id: userId },
        data: {
          activeRole: Role.TALENT,
          experienceChosenAt: user.experienceChosenAt ?? new Date(),
        },
      });
    });

    return this.getProfile(userId);
  }

  async getProfile(userId: string): Promise<TalentProfileResponse> {
    return this.toResponse(await this.requireTalent(userId));
  }

  /**
   * Saves any subset of the wizard's fields.
   *
   * A price change on an **approved** profile sends it back to PENDING_REVIEW: the admin
   * set the commission against the old rate, and the customer price would otherwise move
   * without anyone at Eskista seeing it. Everything else edits in place.
   */
  async updateProfile(userId: string, dto: UpdateTalentProfileDto): Promise<TalentProfileResponse> {
    const talent = await this.requireTalent(userId);
    if (dto.slug !== undefined) await this.assertSlugFree(dto.slug, talent.id);

    const priceChanged = PRICE_FIELDS.some(
      (field) => dto[field] !== undefined && dto[field] !== talent[field],
    );
    const backToReview = priceChanged && talent.status === VerificationStatus.VERIFIED;

    await this.prisma.talentProfile.update({
      where: { id: talent.id },
      data: {
        ...this.profileFields(dto),
        displayName: dto.displayName,
        location: dto.location,
        phone: dto.phone,
        slug: dto.slug !== undefined ? normaliseSlug(dto.slug) : undefined,
        termsAcceptedAt: dto.acceptTerms && !talent.termsAcceptedAt ? new Date() : undefined,
        ...(backToReview
          ? {
              status: VerificationStatus.PENDING_REVIEW,
              submittedAt: new Date(),
              portfolioCheck: ReviewCheckState.PASSED,
              identityCheck: ReviewCheckState.PASSED,
              referenceCheck: ReviewCheckState.PASSED,
            }
          : {}),
      },
    });

    if (backToReview) {
      this.logger.log(`Talent ${talent.id} changed their rate; back to review`);
    }
    return this.getProfile(userId);
  }

  async uploadAvatar(
    userId: string,
    file: UploadedFile | undefined,
  ): Promise<TalentProfileResponse> {
    const valid = assertValidFile(file, {
      allowed: IMAGE_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.image,
      field: 'avatar',
    });
    const talent = await this.requireTalent(userId);

    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      // `public` — the picture is on every card, so any signed-in user may read it.
      folder: `talent/${talent.id}/public/avatar`,
    });
    await this.prisma.talentProfile.update({
      where: { id: talent.id },
      data: { avatarKey: stored.key },
    });
    await this.removeQuietly(talent.avatarKey, stored.key);

    return this.getProfile(userId);
  }

  // ── Repeatable sections ────────────────────────────────────────────────────

  /** Replaces the whole work-experience list, in the order given. */
  async replaceExperience(
    userId: string,
    dto: ReplaceExperienceDto,
  ): Promise<TalentProfileResponse> {
    const talent = await this.requireTalent(userId);
    for (const item of dto.items) {
      if (!item.isCurrent && !item.endDate) {
        throw new BadRequestException(
          `"${item.title}": add an end date, or mark it "Currently working here"`,
        );
      }
      if (item.endDate && item.endDate < item.startDate) {
        throw new BadRequestException(`"${item.title}": end date is before the start date`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.talentExperience.deleteMany({ where: { talentProfileId: talent.id } }),
      this.prisma.talentExperience.createMany({
        data: dto.items.map((item, index) => ({
          talentProfileId: talent.id,
          title: item.title,
          company: item.company,
          startDate: toDate(item.startDate),
          // "Currently working here" means there is no end yet.
          endDate: item.isCurrent ? null : item.endDate ? toDate(item.endDate) : null,
          isCurrent: item.isCurrent ?? false,
          description: item.description,
          sortOrder: index,
        })),
      }),
    ]);
    return this.getProfile(userId);
  }

  async replaceEducation(userId: string, dto: ReplaceEducationDto): Promise<TalentProfileResponse> {
    const talent = await this.requireTalent(userId);
    for (const item of dto.items) {
      if (item.endYear < item.startYear) {
        throw new BadRequestException(`"${item.institution}": end year is before the start year`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.talentEducation.deleteMany({ where: { talentProfileId: talent.id } }),
      this.prisma.talentEducation.createMany({
        data: dto.items.map((item, index) => ({
          talentProfileId: talent.id,
          institution: item.institution,
          fieldOfStudy: item.fieldOfStudy,
          qualification: item.qualification,
          startYear: item.startYear,
          endYear: item.endYear,
          sortOrder: index,
        })),
      }),
    ]);
    return this.getProfile(userId);
  }

  /** The two professional references Eskista calls. Never shown publicly. */
  async replaceReferences(
    userId: string,
    dto: ReplaceReferencesDto,
  ): Promise<TalentProfileResponse> {
    const talent = await this.requireTalent(userId);
    await this.prisma.$transaction([
      this.prisma.talentReference.deleteMany({ where: { talentProfileId: talent.id } }),
      this.prisma.talentReference.createMany({
        data: dto.items.map((item, index) => ({
          talentProfileId: talent.id,
          name: item.name,
          contact: item.contact,
          relationship: item.relationship,
          sortOrder: index,
        })),
      }),
    ]);
    return this.getProfile(userId);
  }

  // ── Portfolio ──────────────────────────────────────────────────────────────

  async listPortfolio(userId: string): Promise<PortfolioResponse[]> {
    const talent = await this.requireTalent(userId);
    return talent.portfolio.map((p) => this.toPortfolio(p));
  }

  async getPortfolioItem(userId: string, id: string): Promise<PortfolioResponse> {
    const talent = await this.requireTalent(userId);
    const item = talent.portfolio.find((p) => p.id === id);
    if (!item) throw new NotFoundException('Project not found');
    return this.toPortfolio(item);
  }

  /**
   * Adds a project, with its cover image in the same request.
   *
   * Capped at five: the September 23 meeting asked for "a curated showcase of 3 to 5 best
   * works", and three are needed to submit.
   */
  async createPortfolioItem(
    userId: string,
    dto: CreatePortfolioDto,
    cover: UploadedFile | undefined,
  ): Promise<PortfolioResponse> {
    const talent = await this.requireTalent(userId);
    if (talent.portfolio.length >= MAX_PORTFOLIO) {
      throw new ConflictException(
        `A portfolio holds up to ${MAX_PORTFOLIO} projects. Remove one to add another.`,
      );
    }
    this.assertDateOrder(dto);
    // "Add cover image" is not marked optional on the design.
    if (!cover) throw new BadRequestException('cover is required');

    const fileKey = await this.storeCover(talent.id, cover);
    const created = await this.prisma.portfolioItem.create({
      data: {
        talentProfileId: talent.id,
        ...this.portfolioFields(dto),
        title: dto.title,
        fileKey,
        sortOrder: talent.portfolio.length,
      },
    });
    return this.toPortfolio(created);
  }

  /** Edits a project. A new `cover` replaces the image ("Replace Image"). */
  async updatePortfolioItem(
    userId: string,
    id: string,
    dto: PortfolioFieldsDto,
    cover: UploadedFile | undefined,
  ): Promise<PortfolioResponse> {
    const talent = await this.requireTalent(userId);
    const item = talent.portfolio.find((p) => p.id === id);
    if (!item) throw new NotFoundException('Project not found');
    this.assertDateOrder({
      startDate: dto.startDate ?? item.startDate?.toISOString().slice(0, 10),
      endDate: dto.endDate ?? item.endDate?.toISOString().slice(0, 10),
    });

    const fileKey = cover ? await this.storeCover(talent.id, cover) : undefined;
    const updated = await this.prisma.portfolioItem.update({
      where: { id },
      data: { ...this.portfolioFields(dto), title: dto.title, fileKey },
    });
    if (fileKey) await this.removeQuietly(item.fileKey, fileKey);
    return this.toPortfolio(updated);
  }

  async deletePortfolioItem(userId: string, id: string): Promise<void> {
    const talent = await this.requireTalent(userId);
    const item = talent.portfolio.find((p) => p.id === id);
    if (!item) throw new NotFoundException('Project not found');

    await this.prisma.portfolioItem.delete({ where: { id } });
    await this.removeQuietly(item.fileKey, null);
  }

  async reorderPortfolio(userId: string, ids: string[]): Promise<PortfolioResponse[]> {
    const talent = await this.requireTalent(userId);
    const own = new Set(talent.portfolio.map((p) => p.id));
    if (ids.length !== own.size || ids.some((id) => !own.has(id))) {
      throw new BadRequestException('Send every portfolio item id exactly once');
    }
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.portfolioItem.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    return this.listPortfolio(userId);
  }

  // ── Services ───────────────────────────────────────────────────────────────

  async listServices(userId: string): Promise<TalentServiceResponse[]> {
    const talent = await this.requireTalent(userId);
    return talent.services.map((s) => this.toService(s));
  }

  /**
   * Adds a priced service. Services are priced with the commission Eskista set at
   * approval, so adding one does not need a fresh review.
   */
  async createService(userId: string, dto: TalentServiceDto): Promise<TalentServiceResponse> {
    const talent = await this.requireTalent(userId);
    const created = await this.prisma.talentService.create({
      data: {
        talentProfileId: talent.id,
        title: dto.title,
        description: dto.description,
        pricingModel: dto.pricingModel,
        priceMinor: dto.priceMinor,
        categoryId: dto.categoryId,
        isActive: dto.isActive ?? true,
        sortOrder: talent.services.length,
      },
    });
    return this.toService(created);
  }

  async updateService(
    userId: string,
    id: string,
    dto: UpdateTalentServiceDto,
  ): Promise<TalentServiceResponse> {
    const talent = await this.requireTalent(userId);
    if (!talent.services.some((s) => s.id === id)) throw new NotFoundException('Service not found');
    const updated = await this.prisma.talentService.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        pricingModel: dto.pricingModel,
        priceMinor: dto.priceMinor,
        isActive: dto.isActive,
      },
    });
    return this.toService(updated);
  }

  /**
   * Removes a service. One already booked is deactivated instead, so the booking keeps
   * pointing at what was bought.
   */
  async deleteService(userId: string, id: string): Promise<void> {
    const talent = await this.requireTalent(userId);
    if (!talent.services.some((s) => s.id === id)) throw new NotFoundException('Service not found');
    const used = await this.prisma.booking.count({ where: { talentServiceId: id } });
    if (used > 0) {
      await this.prisma.talentService.update({ where: { id }, data: { isActive: false } });
      return;
    }
    await this.prisma.talentService.delete({ where: { id } });
  }

  // ── Availability ───────────────────────────────────────────────────────────

  async getAvailability(userId: string): Promise<TalentAvailabilityResponse> {
    const talent = await this.requireTalent(userId);
    const today = toDate(new Date().toISOString().slice(0, 10));

    const [blocked, booked] = await Promise.all([
      this.prisma.talentBlockedDateRange.findMany({
        where: { talentProfileId: talent.id, endDate: { gte: today } },
        orderBy: { startDate: 'asc' },
      }),
      this.prisma.booking.findMany({
        where: {
          talentProfileId: talent.id,
          status: { in: TALENT_COMMITTED },
          endDate: { gte: today },
        },
        orderBy: { startDate: 'asc' },
        select: { reference: true, startDate: true, endDate: true, status: true },
      }),
    ]);

    return {
      workingDays: talent.workingDays,
      dayType: talent.dayType,
      isAvailableForHire: talent.isAvailableForHire,
      blockedDates: blocked.map((b) => ({
        id: b.id,
        startDate: isoDay(b.startDate),
        endDate: isoDay(b.endDate),
        reason: b.reason,
      })),
      booked: booked.map((b) => ({
        reference: b.reference,
        startDate: isoDay(b.startDate),
        endDate: isoDay(b.endDate),
        status: b.status,
      })),
    };
  }

  /**
   * Marks dates unavailable. Refused over dates the talent is already hired for — blocking
   * them would not un-hire anyone, it would only hide the clash.
   */
  async blockDates(userId: string, dto: BlockDatesDto): Promise<TalentAvailabilityResponse> {
    const talent = await this.requireTalent(userId);
    const startDate = toDate(dto.startDate);
    const endDate = toDate(dto.endDate);
    if (endDate < startDate) throw new BadRequestException('endDate must not be before startDate');

    const clash = await this.prisma.booking.findFirst({
      where: {
        talentProfileId: talent.id,
        status: { in: TALENT_COMMITTED },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { reference: true },
    });
    if (clash) {
      throw new ConflictException(
        `You are hired for ${clash.reference} on some of those dates. Contact Eskista to change it.`,
      );
    }

    await this.prisma.talentBlockedDateRange.create({
      data: { talentProfileId: talent.id, startDate, endDate, reason: dto.reason },
    });
    return this.getAvailability(userId);
  }

  async unblockDates(userId: string, id: string): Promise<TalentAvailabilityResponse> {
    const talent = await this.requireTalent(userId);
    const { count } = await this.prisma.talentBlockedDateRange.deleteMany({
      where: { id, talentProfileId: talent.id },
    });
    if (count === 0) throw new NotFoundException('Blocked range not found');
    return this.getAvailability(userId);
  }

  // ── Verification ───────────────────────────────────────────────────────────

  /**
   * Stores the Ethiopian ID or passport the Publish screen asks for.
   *
   * One identity document at a time: a new upload replaces the previous one, whichever
   * type it was. Readable by the talent and Eskista only.
   */
  async uploadIdDocument(
    userId: string,
    type: 'FAYDA_ID' | 'PASSPORT',
    file: UploadedFile | undefined,
  ): Promise<TalentProfileResponse> {
    const valid = assertValidFile(file, {
      allowed: DOCUMENT_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.document,
      field: 'document',
    });
    const talent = await this.requireTalent(userId);

    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      folder: `talent/${talent.id}/documents`,
    });

    const previous = talent.documents.filter((d) => IDENTITY_DOCUMENTS.includes(d.type));
    await this.prisma.$transaction([
      this.prisma.supplierDocument.deleteMany({
        where: { id: { in: previous.map((d) => d.id) } },
      }),
      this.prisma.supplierDocument.create({
        data: {
          talentProfileId: talent.id,
          type,
          fileKey: stored.key,
          fileName: valid.originalname,
          mimeType: valid.mimetype,
          sizeBytes: valid.size,
          status: DocumentStatus.PENDING,
        },
      }),
    ]);
    for (const doc of previous) await this.removeQuietly(doc.fileKey, null);

    return this.getProfile(userId);
  }

  async slugAvailability(userId: string, raw: string): Promise<SlugAvailabilityResponse> {
    const talent = await this.prisma.talentProfile.findUnique({
      where: { userId },
      select: { id: true, displayName: true },
    });
    const slug = normaliseSlug(raw);
    if (!slug) {
      return {
        slug: raw,
        available: false,
        reason: 'Use at least 3 letters or numbers.',
        suggestions: talent ? [await this.suggestSlug(talent.displayName)].filter(isString) : [],
      };
    }

    const reason = await this.slugProblem(slug, talent?.id ?? null);
    return {
      slug,
      available: reason === null,
      reason,
      suggestions: reason ? await this.alternatives(slug) : [],
    };
  }

  /**
   * Sends the profile to Eskista.
   *
   * Sets the checklist the Pending Verification screen shows — identity in progress,
   * portfolio and references queued — and the admin's approval marks them passed.
   */
  async submit(userId: string): Promise<TalentProfileResponse> {
    const talent = await this.requireTalent(userId);

    if (talent.status === VerificationStatus.PENDING_REVIEW) {
      throw new ConflictException('Your profile is already being reviewed');
    }
    if (talent.status === VerificationStatus.VERIFIED) {
      throw new ConflictException('Your profile is already approved');
    }
    if (talent.status === VerificationStatus.SUSPENDED) {
      throw new BadRequestException('A suspended profile cannot be resubmitted; contact support');
    }

    const { submitBlockers } = computeCompletion(this.completionInput(talent));
    if (submitBlockers.length > 0) {
      throw new BadRequestException({
        message: 'Your profile is not ready to submit',
        outstandingRequirements: submitBlockers,
      });
    }

    await this.prisma.talentProfile.update({
      where: { id: talent.id },
      data: {
        status: VerificationStatus.PENDING_REVIEW,
        submittedAt: new Date(),
        rejectionReason: null,
        identityCheck: ReviewCheckState.IN_PROGRESS,
        portfolioCheck: ReviewCheckState.QUEUED,
        referenceCheck: ReviewCheckState.QUEUED,
      },
    });
    await this.notifications.send(userId, 'TALENT_PROFILE_SUBMITTED');
    const submitted = await this.prisma.talentProfile.findUnique({
      where: { userId },
      select: { id: true, displayName: true },
    });
    if (submitted) {
      await this.notifications.notifyAdmins(
        'ADMIN_SUPPLIER_SUBMITTED',
        { name: submitted.displayName, kind: 'talent' },
        { talentProfileId: submitted.id },
        [AdminTier.ADMIN],
      );
    }

    return this.getProfile(userId);
  }

  // ── Shared ─────────────────────────────────────────────────────────────────

  async requireTalent(userId: string): Promise<TalentWithSections> {
    const talent = await this.prisma.talentProfile.findUnique({
      where: { userId },
      include: talentInclude,
    });
    if (!talent) {
      throw new NotFoundException(
        'No talent profile yet. Start with POST /api/v1/talent/onboarding.',
      );
    }
    return talent;
  }

  completionInput(talent: TalentWithSections) {
    return {
      displayName: talent.displayName,
      phone: talent.phone,
      email: talent.email,
      location: talent.location,
      yearsExperience: talent.yearsExperience,
      bio: talent.bio,
      baseRateMinor: talent.baseRateMinor,
      activeServiceCount: talent.services.filter((s) => s.isActive).length,
      languages: talent.languages,
      hasAvatar: !!talent.avatarKey,
      termsAccepted: !!talent.termsAcceptedAt,
      professions: talent.professions,
      workingDays: talent.workingDays,
      dayType: talent.dayType,
      experienceCount: talent.experiences.length,
      educationCount: talent.educations.length,
      skills: talent.skills,
      portfolioCount: talent.portfolio.length,
      hasIdDocument: talent.documents.some(
        (d) => IDENTITY_DOCUMENTS.includes(d.type) && d.status !== DocumentStatus.REJECTED,
      ),
      referenceCount: talent.references.length,
      slug: talent.slug,
    };
  }

  toResponse(talent: TalentWithSections): TalentProfileResponse {
    const completion = computeCompletion(this.completionInput(talent));
    const approval =
      talent.status === VerificationStatus.VERIFIED
        ? 'APPROVED'
        : talent.status === VerificationStatus.REJECTED
          ? 'REJECTED'
          : 'PENDING';

    return {
      id: talent.id,
      status: talent.status,
      rejectionReason: talent.rejectionReason,
      displayName: talent.displayName,
      headline: talent.headline,
      phone: talent.phone,
      email: talent.email,
      location: talent.location,
      yearsExperience: talent.yearsExperience,
      experienceLevel: talent.experienceLevel,
      bio: talent.bio,
      baseRateMinor: talent.baseRateMinor,
      pricingModel: talent.pricingModel,
      languages: talent.languages,
      avatarUrl: talentAvatarUrl(talent, this.storage),
      termsAcceptedAt: talent.termsAcceptedAt?.toISOString() ?? null,
      professions: talent.professions,
      specializations: talent.specializations,
      workingDays: talent.workingDays,
      dayType: talent.dayType,
      highestEducation: talent.highestEducation,
      skills: talent.skills,
      cvTemplate: talent.cvTemplate,
      slug: talent.slug,
      profileUrl: profileUrlFor(talent.slug),
      isAvailableForHire: talent.isAvailableForHire,
      commissionRateBps:
        talent.status === VerificationStatus.VERIFIED ? talent.commissionRateBps : null,
      experience: talent.experiences.map((e) => ({
        id: e.id,
        title: e.title,
        company: e.company,
        startDate: e.startDate ? isoDay(e.startDate) : null,
        endDate: e.endDate ? isoDay(e.endDate) : null,
        isCurrent: e.isCurrent,
        description: e.description,
      })),
      education: talent.educations.map((e) => ({
        id: e.id,
        institution: e.institution,
        fieldOfStudy: e.fieldOfStudy,
        qualification: e.qualification,
        startYear: e.startYear,
        endYear: e.endYear,
      })),
      references: talent.references.map((r) => ({
        id: r.id,
        name: r.name,
        contact: r.contact,
        relationship: r.relationship,
      })),
      portfolio: talent.portfolio.map((p) => this.toPortfolio(p)),
      services: talent.services.map((s) => this.toService(s)),
      documents: talent.documents.map((d) => ({
        id: d.id,
        type: d.type,
        status: d.status,
        fileName: d.fileName,
        url: this.storage.urlFor(d.fileKey),
        rejectionReason: d.rejectionReason,
        uploadedAt: d.createdAt.toISOString(),
      })),
      steps: completion.steps,
      completionPercent: completion.percent,
      submitBlockers: completion.submitBlockers,
      canSubmit:
        completion.submitBlockers.length === 0 &&
        (talent.status === VerificationStatus.DRAFT ||
          talent.status === VerificationStatus.REJECTED),
      reviewChecklist: {
        identity: talent.identityCheck,
        portfolio: talent.portfolioCheck,
        references: talent.referenceCheck,
        approval,
        note: 'Typical review: 2–3 business days',
      },
    };
  }

  toPortfolio(p: {
    id: string;
    title: string;
    clientOrAgency: string | null;
    role: string | null;
    startDate: Date | null;
    endDate: Date | null;
    description: string | null;
    fileKey: string | null;
    externalUrl: string | null;
    sortOrder: number;
  }): PortfolioResponse {
    return {
      id: p.id,
      title: p.title,
      client: p.clientOrAgency,
      role: p.role,
      startDate: p.startDate ? isoDay(p.startDate) : null,
      endDate: p.endDate ? isoDay(p.endDate) : null,
      description: p.description,
      coverUrl: p.fileKey ? this.storage.urlFor(p.fileKey) : null,
      workLink: p.externalUrl,
      sortOrder: p.sortOrder,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private profileFields(dto: UpdateTalentProfileDto) {
    return {
      email: dto.email,
      yearsExperience: dto.yearsExperience,
      experienceLevel: dto.experienceLevel,
      bio: dto.bio,
      headline: dto.headline,
      baseRateMinor: dto.baseRateMinor,
      pricingModel: dto.pricingModel,
      languages: dto.languages,
      professions: dto.professions,
      specializations: dto.specializations,
      workingDays: dto.workingDays,
      dayType: dto.dayType,
      highestEducation: dto.highestEducation,
      skills: dto.skills,
      cvTemplate: dto.cvTemplate,
      isAvailableForHire: dto.isAvailableForHire,
    };
  }

  private portfolioFields(dto: PortfolioFieldsDto) {
    return {
      clientOrAgency: dto.client,
      role: dto.role,
      startDate: dto.startDate ? toDate(dto.startDate) : undefined,
      endDate: dto.endDate ? toDate(dto.endDate) : undefined,
      description: dto.description,
      externalUrl: dto.workLink,
    };
  }

  private assertDateOrder(d: { startDate?: string; endDate?: string }): void {
    if (d.startDate && d.endDate && d.endDate < d.startDate) {
      throw new BadRequestException('The end date is before the start date');
    }
  }

  private async storeCover(talentId: string, cover: UploadedFile): Promise<string> {
    const valid = assertValidFile(cover, {
      allowed: IMAGE_MIME_TYPES,
      maxBytes: UPLOAD_LIMITS.image,
      field: 'cover',
    });
    const stored = await this.storage.put({
      buffer: valid.buffer,
      originalName: valid.originalname,
      mimeType: valid.mimetype,
      folder: `talent/${talentId}/public/portfolio`,
    });
    return stored.key;
  }

  private toService(s: {
    id: string;
    title: string;
    description: string | null;
    pricingModel: TalentServiceResponse['pricingModel'];
    priceMinor: number;
    isActive: boolean;
  }): TalentServiceResponse {
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      pricingModel: s.pricingModel,
      priceMinor: s.priceMinor,
      isActive: s.isActive,
    };
  }

  private async assertSlugFree(raw: string, talentId: string | null): Promise<void> {
    const slug = normaliseSlug(raw);
    if (!slug) throw new BadRequestException('The profile URL needs at least 3 letters or numbers');
    const problem = await this.slugProblem(slug, talentId);
    if (problem) {
      throw new ConflictException({
        message: problem,
        suggestions: await this.alternatives(slug),
      });
    }
  }

  private async slugProblem(slug: string, talentId: string | null): Promise<string | null> {
    if (RESERVED_SLUGS.has(slug)) return 'That URL is reserved.';
    const owner = await this.prisma.talentProfile.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (owner && owner.id !== talentId) return 'That URL is taken.';
    return null;
  }

  /** A free slug from the name, or null if even the numbered variants are taken. */
  private async suggestSlug(name: string): Promise<string | null> {
    const base = normaliseSlug(name);
    if (!base) return null;
    if (!(await this.slugProblem(base, null))) return base;
    return (await this.alternatives(base))[0] ?? null;
  }

  private async alternatives(slug: string): Promise<string[]> {
    const candidates = [2, 3, 4, 5, 6].map((n) => `${slug.slice(0, 37)}-${n}`);
    const taken = await this.prisma.talentProfile.findMany({
      where: { slug: { in: candidates } },
      select: { slug: true },
    });
    const takenSet = new Set(taken.map((t) => t.slug));
    return candidates.filter((c) => !takenSet.has(c)).slice(0, 3);
  }

  /** Deletes a superseded file. Best effort: the row already points at the new one. */
  private async removeQuietly(key: string | null, keep: string | null): Promise<void> {
    if (!key || key === keep) return;
    await this.storage.remove(key).catch((error: unknown) => {
      this.logger.warn(`Could not remove superseded file ${key}: ${String(error)}`);
    });
  }
}

function toDate(value: string): Date {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
  return date;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isString(value: string | null): value is string {
  return typeof value === 'string';
}
