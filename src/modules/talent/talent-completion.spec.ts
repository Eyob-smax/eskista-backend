import {
  type CompletionInput,
  MIN_PORTFOLIO,
  computeCompletion,
  normaliseSlug,
} from './talent-completion';

const complete: CompletionInput = {
  displayName: 'Dawit Bekele',
  phone: '+251911223344',
  email: 'hello@dawitmedia.et',
  location: 'Addis Ababa',
  yearsExperience: 8,
  bio: 'Cinematographer with eight years in commercials.',
  baseRateMinor: 300_000,
  activeServiceCount: 0,
  languages: ['Amharic', 'English'],
  hasAvatar: true,
  termsAccepted: true,
  professions: ['Cinematographer'],
  workingDays: ['MON', 'WED'],
  dayType: 'FULL_DAY',
  experienceCount: 2,
  educationCount: 1,
  skills: ['DaVinci Resolve'],
  portfolioCount: 3,
  hasIdDocument: true,
  referenceCount: 2,
  slug: 'dawit-media',
};

describe('computeCompletion', () => {
  it('is 100% with nothing blocking for a finished profile', () => {
    const c = computeCompletion(complete);
    expect(c.percent).toBe(100);
    expect(c.submitBlockers).toEqual([]);
  });

  it('has the eight steps the wizard shows, in order, all required', () => {
    const { steps } = computeCompletion(complete);
    expect(steps.map((s) => s.key)).toEqual([
      'BASIC_INFO',
      'PROFESSION',
      'AVAILABILITY',
      'EXPERIENCE',
      'EDUCATION',
      'SKILLS',
      'PORTFOLIO',
      'PUBLISH',
    ]);
    expect(steps.every((s) => s.required)).toBe(true);
  });

  it('requires the steps the designs show, not only the ones the meeting kept', () => {
    const c = computeCompletion({
      ...complete,
      workingDays: [],
      dayType: null,
      experienceCount: 0,
      educationCount: 0,
      skills: [],
    });
    expect(c.submitBlockers).toEqual([
      'Choose your working days',
      'Choose full day, half day or flexible',
      'Add at least one work experience',
      'Add your education',
      'Add at least one skill',
    ]);
    expect(c.percent).toBe(50); // 4 of 8 steps done
  });

  it('requires every step-1 field the design does not mark optional', () => {
    const c = computeCompletion({
      ...complete,
      email: null,
      yearsExperience: null,
      languages: [],
    });
    expect(c.submitBlockers).toEqual([
      'Add an email address',
      'Add your years of experience',
      'Add the languages you work in',
    ]);
  });

  it('counts zero years of experience as answered', () => {
    expect(computeCompletion({ ...complete, yearsExperience: 0 }).submitBlockers).toEqual([]);
  });

  it('requires what the Publish screen says Eskista verifies', () => {
    const c = computeCompletion({
      ...complete,
      portfolioCount: 2,
      hasIdDocument: false,
      referenceCount: 1,
    });
    expect(c.submitBlockers).toEqual([
      `Add at least ${MIN_PORTFOLIO} portfolio projects (you have 2)`,
      'Upload your national ID or passport',
      'Add 2 professional references (you have 1)',
    ]);
  });

  it('requires the profile picture the design marks with an asterisk', () => {
    expect(computeCompletion({ ...complete, hasAvatar: false }).submitBlockers).toContain(
      'Upload a profile picture',
    );
  });

  it('accepts a priced service in place of a base rate', () => {
    const c = computeCompletion({ ...complete, baseRateMinor: null, activeServiceCount: 1 });
    expect(c.submitBlockers).not.toContain('Set your minimum day rate');
  });

  it('starts at zero for a brand new profile', () => {
    const c = computeCompletion({
      ...complete,
      phone: null,
      email: null,
      yearsExperience: null,
      bio: null,
      baseRateMinor: null,
      languages: [],
      hasAvatar: false,
      termsAccepted: false,
      professions: [],
      workingDays: [],
      dayType: null,
      experienceCount: 0,
      educationCount: 0,
      skills: [],
      portfolioCount: 0,
      hasIdDocument: false,
      referenceCount: 0,
      slug: null,
    });
    expect(c.percent).toBe(0);
    expect(c.submitBlockers.length).toBeGreaterThan(10);
  });
});

describe('normaliseSlug', () => {
  it('turns a name into a URL slug', () => {
    expect(normaliseSlug('Dawit Media!')).toBe('dawit-media');
    expect(normaliseSlug('  --Amina  Tesfaye--  ')).toBe('amina-tesfaye');
  });

  it('refuses something too short to be useful', () => {
    expect(normaliseSlug('a')).toBeNull();
    expect(normaliseSlug('!!!')).toBeNull();
  });

  it('caps the length without leaving a trailing hyphen', () => {
    const s = normaliseSlug('a'.repeat(39) + ' b');
    expect(s?.length).toBeLessThanOrEqual(40);
    expect(s?.endsWith('-')).toBe(false);
  });
});
