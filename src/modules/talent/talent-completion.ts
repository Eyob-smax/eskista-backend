/**
 * How complete a talent's profile is, and what still stops them submitting it.
 *
 * Pure, so the wizard's progress bar, the dashboard's "78%" and the submit gate all come
 * from one function and cannot disagree.
 *
 * Follows the September 25 designs, which are newer than the September 23 meeting notes:
 * every wizard step is part of the profile, and a field is required unless the design labels
 * it "(optional)" — specializations, unavailable dates, descriptions and work links are the
 * optional ones. Eight steps, matching "Profile N of 8"; the CV preview is not a step of its
 * own, it renders what the other steps collected.
 */

export type StepKey =
  | 'BASIC_INFO'
  | 'PROFESSION'
  | 'AVAILABILITY'
  | 'EXPERIENCE'
  | 'EDUCATION'
  | 'SKILLS'
  | 'PORTFOLIO'
  | 'PUBLISH';

/** What Eskista verifies, from the Publish screen: "Professional portfolio (3+ pieces)". */
export const MIN_PORTFOLIO = 3;
/** "A curated showcase of 3 to 5 best works" — the September 23 meeting; no design conflicts. */
export const MAX_PORTFOLIO = 5;
/** "At least 2 professional references". */
export const MIN_REFERENCES = 2;

export interface CompletionInput {
  displayName: string;
  phone: string | null;
  email: string | null;
  location: string;
  yearsExperience: number | null;
  bio: string | null;
  baseRateMinor: number | null;
  activeServiceCount: number;
  languages: string[];
  hasAvatar: boolean;
  termsAccepted: boolean;
  professions: string[];
  workingDays: string[];
  dayType: string | null;
  experienceCount: number;
  educationCount: number;
  skills: string[];
  portfolioCount: number;
  hasIdDocument: boolean;
  referenceCount: number;
  slug: string | null;
}

export interface StepState {
  key: StepKey;
  label: string;
  complete: boolean;
  /** Every step is required by the designs; kept so a client can render it generically. */
  required: boolean;
}

export interface Completion {
  steps: StepState[];
  percent: number;
  /** What must be done before `POST /talent/me/submit`, in words a talent can act on. */
  submitBlockers: string[];
}

export function computeCompletion(p: CompletionInput): Completion {
  const hasPrice = (p.baseRateMinor ?? 0) > 0 || p.activeServiceCount > 0;

  // Step 1, in the order the screen asks for it.
  const basicBlockers: string[] = [];
  if (!p.displayName.trim()) basicBlockers.push('Add your professional name');
  if (!p.phone) basicBlockers.push('Add a phone number');
  if (!p.email) basicBlockers.push('Add an email address');
  if (!p.location.trim()) basicBlockers.push('Add your location');
  if (p.yearsExperience === null) basicBlockers.push('Add your years of experience');
  if (!p.bio?.trim()) basicBlockers.push('Write a short professional bio');
  if (!hasPrice) basicBlockers.push('Set your minimum day rate');
  if (p.languages.length === 0) basicBlockers.push('Add the languages you work in');
  if (!p.hasAvatar) basicBlockers.push('Upload a profile picture');
  if (!p.termsAccepted) basicBlockers.push('Accept the terms and conditions');

  const steps: { key: StepKey; label: string; blockers: string[] }[] = [
    { key: 'BASIC_INFO', label: 'Basic information', blockers: basicBlockers },
    {
      key: 'PROFESSION',
      label: 'Profession',
      blockers: p.professions.length === 0 ? ['Choose your primary profession'] : [],
    },
    {
      key: 'AVAILABILITY',
      label: 'Availability',
      blockers: [
        ...(p.workingDays.length === 0 ? ['Choose your working days'] : []),
        ...(!p.dayType ? ['Choose full day, half day or flexible'] : []),
      ],
    },
    {
      key: 'EXPERIENCE',
      label: 'Work experience',
      blockers: p.experienceCount === 0 ? ['Add at least one work experience'] : [],
    },
    {
      key: 'EDUCATION',
      label: 'Education',
      blockers: p.educationCount === 0 ? ['Add your education'] : [],
    },
    {
      key: 'SKILLS',
      label: 'Skills',
      blockers: p.skills.length === 0 ? ['Add at least one skill'] : [],
    },
    {
      key: 'PORTFOLIO',
      label: 'Portfolio',
      blockers:
        p.portfolioCount < MIN_PORTFOLIO
          ? [`Add at least ${MIN_PORTFOLIO} portfolio projects (you have ${p.portfolioCount})`]
          : [],
    },
    {
      key: 'PUBLISH',
      label: 'Verification',
      blockers: [
        ...(!p.hasIdDocument ? ['Upload your national ID or passport'] : []),
        ...(p.referenceCount < MIN_REFERENCES
          ? [`Add ${MIN_REFERENCES} professional references (you have ${p.referenceCount})`]
          : []),
        ...(!p.slug ? ['Choose your profile URL'] : []),
      ],
    },
  ];

  const done = steps.filter((s) => s.blockers.length === 0).length;

  return {
    steps: steps.map((s) => ({
      key: s.key,
      label: s.label,
      complete: s.blockers.length === 0,
      required: true,
    })),
    percent: Math.round((done / steps.length) * 100),
    submitBlockers: steps.flatMap((s) => s.blockers),
  };
}

/**
 * Normalises a requested profile URL: lowercase, hyphens, a-z0-9 only.
 *
 * "Dawit Media!" → "dawit-media". Returns null when nothing usable is left.
 */
export function normaliseSlug(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : null;
}

/** Slugs that would collide with app routes or read as official. */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'eskista',
  'me',
  'new',
  'settings',
  'support',
  'talent',
  'vendor',
]);
