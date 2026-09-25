import { buildCv, dateRange, type CvSource } from './talent-cv';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const source: CvSource = {
  displayName: 'Dawit Bekele',
  headline: null,
  location: 'Addis Ababa',
  email: 'hello@dawitmedia.et',
  phone: '+251911223344',
  bio: 'Cinematographer.',
  professions: ['Cinematographer', 'Colorist'],
  specializations: ['Commercial'],
  skills: ['DaVinci Resolve', 'Commercial'],
  languages: ['Amharic', 'English'],
  highestEducation: 'BA Film, Addis Ababa University',
  cvTemplate: 'SIDEBAR',
  experiences: [
    {
      title: 'Senior Cinematographer',
      company: 'Tigist Media',
      startDate: d('2020-01-01'),
      endDate: d('2023-01-01'),
      isCurrent: true,
      description: null,
    },
  ],
  educations: [],
  portfolio: [
    {
      title: 'Abay Campaign',
      clientOrAgency: 'Abay Trading',
      role: 'DoP',
      startDate: d('2026-08-16'),
      endDate: d('2026-08-30'),
      description: null,
    },
  ],
};

describe('buildCv', () => {
  it('keeps contact details off anything a client sees', () => {
    const cv = buildCv(source, { includeContact: false, avatarUrl: null, profileUrl: null });
    expect(cv.email).toBeNull();
    expect(cv.phone).toBeNull();
  });

  it('shows them on the talent’s own copy', () => {
    const cv = buildCv(source, { includeContact: true, avatarUrl: null, profileUrl: null });
    expect(cv.email).toBe('hello@dawitmedia.et');
  });

  it('falls back to the one-line education when there are no entries', () => {
    const cv = buildCv(source, { includeContact: false, avatarUrl: null, profileUrl: null });
    expect(cv.education).toEqual([
      { title: 'BA Film, Addis Ababa University', subtitle: null, period: null, description: null },
    ]);
  });

  it('reads the headline from the professions when none was written', () => {
    const cv = buildCv(source, { includeContact: false, avatarUrl: null, profileUrl: null });
    expect(cv.headline).toBe('Cinematographer · Colorist');
    expect(cv.template).toBe('SIDEBAR');
  });

  it('merges specializations into skills without duplicates', () => {
    const cv = buildCv(source, { includeContact: false, avatarUrl: null, profileUrl: null });
    expect(cv.skills).toEqual(['DaVinci Resolve', 'Commercial']);
  });

  it('says "Present" for a current role, ignoring any stale end date', () => {
    const cv = buildCv(source, { includeContact: false, avatarUrl: null, profileUrl: null });
    expect(cv.experience[0]?.period).toBe('Jan 2020 – Present');
    expect(cv.portfolio[0]?.subtitle).toBe('DoP · Abay Trading');
  });
});

describe('dateRange', () => {
  it('collapses a range within one month', () => {
    expect(dateRange(d('2026-08-16'), d('2026-08-30'), false)).toBe('Aug 2026');
  });

  it('prints nothing when there is nothing to print', () => {
    expect(dateRange(null, null, false)).toBeNull();
  });
});
