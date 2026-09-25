import type { CvTemplate } from '@prisma/client';

/**
 * The auto-generated CV: "built from what you entered".
 *
 * One pure builder feeds the JSON preview, the talent's own PDF and the client-facing PDF,
 * so the three can never disagree. `includeContact` is false for anything a client sees —
 * clients deal with talent only through Eskista.
 */

export interface CvEntry {
  title: string;
  subtitle: string | null;
  period: string | null;
  description: string | null;
}

export interface CvDocument {
  template: CvTemplate;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  location: string;
  email: string | null;
  phone: string | null;
  bio: string | null;
  professions: string[];
  skills: string[];
  languages: string[];
  experience: CvEntry[];
  education: CvEntry[];
  portfolio: CvEntry[];
  profileUrl: string | null;
}

export interface CvSource {
  displayName: string;
  headline: string | null;
  location: string;
  email: string | null;
  phone: string | null;
  bio: string | null;
  professions: string[];
  specializations: string[];
  skills: string[];
  languages: string[];
  highestEducation: string | null;
  cvTemplate: CvTemplate;
  experiences: {
    title: string;
    company: string | null;
    startDate: Date | null;
    endDate: Date | null;
    isCurrent: boolean;
    description: string | null;
  }[];
  educations: {
    institution: string;
    fieldOfStudy: string | null;
    qualification: string | null;
    startYear: number | null;
    endYear: number | null;
  }[];
  portfolio: {
    title: string;
    clientOrAgency: string | null;
    role: string | null;
    startDate: Date | null;
    endDate: Date | null;
    description: string | null;
  }[];
}

export function buildCv(
  source: CvSource,
  options: { includeContact: boolean; avatarUrl: string | null; profileUrl: string | null },
): CvDocument {
  const education: CvEntry[] = source.educations.map((e) => ({
    title: [e.qualification, e.fieldOfStudy].filter(Boolean).join(', ') || e.institution,
    subtitle: e.qualification || e.fieldOfStudy ? e.institution : null,
    period: yearRange(e.startYear, e.endYear),
    description: null,
  }));
  // Legacy single-line education, for profiles saved before the Education step existed.
  if (education.length === 0 && source.highestEducation) {
    education.push({
      title: source.highestEducation,
      subtitle: null,
      period: null,
      description: null,
    });
  }

  return {
    template: source.cvTemplate,
    name: source.displayName,
    headline:
      source.headline ?? (source.professions.length > 0 ? source.professions.join(' · ') : null),
    avatarUrl: options.avatarUrl,
    location: source.location,
    email: options.includeContact ? source.email : null,
    phone: options.includeContact ? source.phone : null,
    bio: source.bio,
    professions: source.professions,
    // Specializations read as skills on a CV; merged without duplicates.
    skills: [...new Set([...source.skills, ...source.specializations])],
    languages: source.languages,
    experience: source.experiences.map((e) => ({
      title: e.title,
      subtitle: e.company,
      period: dateRange(e.startDate, e.isCurrent ? null : e.endDate, e.isCurrent),
      description: e.description,
    })),
    education,
    portfolio: source.portfolio.map((p) => ({
      title: p.title,
      subtitle: [p.role, p.clientOrAgency].filter(Boolean).join(' · ') || null,
      period: dateRange(p.startDate, p.endDate, false),
      description: p.description,
    })),
    profileUrl: options.profileUrl,
  };
}

/** "Jan 2020 – Present", "Mar 2024", or null. */
export function dateRange(start: Date | null, end: Date | null, current: boolean): string | null {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (!start && !end) return current ? 'Present' : null;
  if (start && current) return `${fmt(start)} – Present`;
  if (start && end) return fmt(start) === fmt(end) ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  return fmt((start ?? end)!);
}

function yearRange(start: number | null, end: number | null): string | null {
  if (start && end) return start === end ? String(start) : `${start} – ${end}`;
  if (start) return `${start} –`;
  if (end) return String(end);
  return null;
}
