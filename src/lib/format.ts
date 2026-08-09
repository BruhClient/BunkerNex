/** Prices are quoted to at most 1 decimal in the source. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/**
 * Tonnages, to the nearest tonne. The source quotes stems and ROB to a
 * fraction the trade does not use, and a thousands separator is what makes a
 * four-figure stem readable at a glance.
 */
export function formatMt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return Math.round(value).toLocaleString("en-US");
}

export function formatDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${Math.abs(delta).toFixed(1)}`;
}

export function formatPercent(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "";
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/** "2026-01-02" -> "02 Jan 2026". Parsed as UTC to avoid a timezone shift. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Compact axis form: "Jan 26". */
export function formatDateShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function formatDays(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return "—";
  return `${days}d`;
}
