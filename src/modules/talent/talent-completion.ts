/**
 * How complete a talent's profile is, and what still stops them submitting it.
 *
 * Pure, so the wizard's progress bar, the dashboard's "78%" and the submit gate all come
 * from one function and cannot disagree.
 *
 * Eight steps, matching "Profile N of 8" in the designs. The CV preview is not a step of
 * its own — it renders what the other steps collected.
 *
 * Availability, experience, education and skills count towards the percentage but never
 * block submission: the September 23 meeting removed them, the September 25 designs still
 * show them, and a talent should not be held back by a section the client may drop.
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

/** What Eskista verifies, from the Publish screen. */
export const MIN_PORTFOLIO = 3;
/** "A curated showcase of 3 to 5 best works" — the September 23 meeting. */
export const MAX_PORTFOLIO = 5;
export const MIN_REFERENCES = 2;

export interface CompletionInput {
  displayName: string;
  phone: string | null;
  location: string;
  bio: string | null;
  baseRateMinor: number | null;
  activeServiceCount: number;
  hasAvatar: boolean;
  termsAccepted: boolean;
  professions: string[];
  workingDays: string[];
  dayType: string | null;
  experienceCount: number;
  educationCount: number;
  highestEducation: string | null;
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
  /** False for the steps the client may remove; they never block submission. */
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

  const basic =
    p.displayName.trim().length > 0 &&
    !!p.phone &&
    p.location.trim().length > 0 &&
    !!p.bio?.trim() &&
    hasPrice &&
    p.hasAvatar &&
    p.termsAccepted;

  const steps: StepState[] = [
    { key: 'BASIC_INFO', label: 'Basic information', complete: basic, required: true },
    {
      key: 'PROFESSION',
      label: 'Profession',
      complete: p.professions.length > 0,
      required: true,
    },
    {
      key: 'AVAILABILITY',
      label: 'Availability',
      complete: p.workingDays.length > 0 && !!p.dayType,
      required: false,
    },
    {
      key: 'EXPERIENCE',
      label: 'Work experience',
      complete: p.experienceCount > 0,
      required: false,
    },
    {
      key: 'EDUCATION',
      label: 'Education',
      complete: p.educationCount > 0 || !!p.highestEducation?.trim(),
      required: false,
    },
    { key: 'SKILLS', label: 'Skills', complete: p.skills.length > 0, required: false },
    {
      key: 'PORTFOLIO',
      label: 'Portfolio',
      complete: p.portfolioCount >= MIN_PORTFOLIO,
      required: true,
    },
    {
      key: 'PUBLISH',
      label: 'Verification',
      complete: p.hasIdDocument && p.referenceCount >= MIN_REFERENCES && !!p.slug,
      required: true,
    },
  ];

  const blockers: string[] = [];
  if (!p.displayName.trim()) blockers.push('Add your professional name');
  if (!p.phone) blockers.push('Add a phone number');
  if (!p.location.trim()) blockers.push('Add your location');
  if (!p.bio?.trim()) blockers.push('Write a short professional bio');
  if (!hasPrice) blockers.push('Set your minimum day rate');
  if (!p.hasAvatar) blockers.push('Upload a profile picture');
  if (!p.termsAccepted) blockers.push('Accept the terms and conditions');
  if (p.professions.length === 0) blockers.push('Choose your profession');
  if (p.portfolioCount < MIN_PORTFOLIO) {
    blockers.push(
      `Add at least ${MIN_PORTFOLIO} portfolio projects (you have ${p.portfolioCount})`,
    );
  }
  if (!p.hasIdDocument) blockers.push('Upload your national ID or passport');
  if (p.referenceCount < MIN_REFERENCES) {
    blockers.push(`Add ${MIN_REFERENCES} professional references (you have ${p.referenceCount})`);
  }
  if (!p.slug) blockers.push('Choose your profile URL');

  const done = steps.filter((s) => s.complete).length;

  return {
    steps,
    percent: Math.round((done / steps.length) * 100),
    submitBlockers: blockers,
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
