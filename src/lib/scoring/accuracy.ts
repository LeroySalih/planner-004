export function computeAccuracyByUser(
  entries: Array<{ userId: string; score: number | null }>,
): Map<string, number | null> {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const entry of entries) {
    if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) {
      continue;
    }
    const existing = totals.get(entry.userId) ?? { sum: 0, count: 0 };
    existing.sum += entry.score;
    existing.count += 1;
    totals.set(entry.userId, existing);
  }
  const accuracyByUser = new Map<string, number | null>();
  for (const [userId, { sum, count }] of totals) {
    accuracyByUser.set(userId, count > 0 ? sum / count : null);
  }
  return accuracyByUser;
}
