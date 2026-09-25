import {
  type CompletionInput,
  MIN_PORTFOLIO,
  computeCompletion,
  normaliseSlug,
} from './talent-completion';

const complete: CompletionInput = {
  displayName: 'Dawit Bekele',
  phone: '+251911223344',
  location: 'Addis Ababa',
  bio: 'Cinematographer with eight years in commercials.',
  baseRateMinor: 300_000,
  activeServiceCount: 0,
  hasAvatar: true,
  termsAccepted: true,
  professions: ['Cinematographer'],
  workingDays: ['MON', 'WED'],
  dayType: 'FULL_DAY',
  experienceCount: 2,
  educationCount: 1,
  highestEducation: null,
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

  it('has the eight steps the wizard shows, in order', () => {
    expect(computeCompletion(complete).steps.map((s) => s.key)).toEqual([
      'BASIC_INFO',
      'PROFESSION',
      'AVAILABILITY',
      'EXPERIENCE',
      'EDUCATION',
      'SKILLS',
      'PORTFOLIO',
      'PUBLISH',
    ]);
  });

  it('never blocks submission on the sections the client may remove', () => {
    // The Sept 23 notes removed availability, experience, education and skills.
    const c = computeCompletion({
      ...complete,
      workingDays: [],
      dayType: null,
      experienceCount: 0,
      educationCount: 0,
      skills: [],
    });
    expect(c.submitBlockers).toEqual([]);
    expect(c.percent).toBeLessThan(100);
  });

  it('accepts the single highest-education line in place of education entries', () => {
    const c = computeCompletion({ ...complete, educationCount: 0, highestEducation: 'BA Film' });
    expect(c.steps.find((s) => s.key === 'EDUCATION')?.complete).toBe(true);
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

  it('starts near zero for a brand new profile', () => {
    const c = computeCompletion({
      ...complete,
      phone: null,
      bio: null,
      baseRateMinor: null,
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
    expect(c.submitBlockers.length).toBeGreaterThan(5);
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
