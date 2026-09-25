import { BudgetBand } from '@prisma/client';
import type { StorageDriver } from '../storage/storage.interface';

/**
 * The profile picture to show: the one the talent uploaded, else their Telegram photo.
 *
 * Uploaded avatars live under `talent/<id>/public/`, which any signed-in user may read.
 */
export function talentAvatarUrl(
  profile: { avatarKey: string | null; user?: { image: string | null } | null },
  storage: StorageDriver,
): string | null {
  if (profile.avatarKey) return storage.urlFor(profile.avatarKey);
  return profile.user?.image ?? null;
}

/** "ETB 10k – 25k", as the hire-request cards print the budget. */
export const BUDGET_BAND_LABELS: Record<BudgetBand, string> = {
  UNDER_5K: 'Under ETB 5k',
  FROM_5K_TO_10K: 'ETB 5k – 10k',
  FROM_10K_TO_25K: 'ETB 10k – 25k',
  FROM_25K_TO_50K: 'ETB 25k – 50k',
  OVER_50K: 'Over ETB 50k',
};

export function budgetLabel(
  band: BudgetBand | null | undefined,
  exactMinor: number | null | undefined,
): string | null {
  if (band) return BUDGET_BAND_LABELS[band];
  if (exactMinor && exactMinor > 0) {
    return `ETB ${Math.round(exactMinor / 100).toLocaleString('en-US')}`;
  }
  return null;
}

/** Title-cases an enum such as BRAND_CAMPAIGN into "Brand campaign". */
export function humanise(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Public link to a profile. The host is fixed by the design: eskista.com/talent/<slug>. */
export function profileUrlFor(slug: string | null): string | null {
  return slug ? `https://eskista.com/talent/${slug}` : null;
}
