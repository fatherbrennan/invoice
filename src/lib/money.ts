const currency = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});

export function money(cents: number): string {
  if (!Number.isSafeInteger(cents))
    throw new Error('Amount exceeds the supported exact amount limit');
  // Formatting cents/100 as a float can lose a cent on large aggregate amounts.
  const dollars = cents < 0 && cents > -100 ? -0 : BigInt(cents) / 100n;
  return currency
    .formatToParts(dollars)
    .map((part) =>
      part.type === 'fraction'
        ? String(Math.abs(cents % 100)).padStart(2, '0')
        : part.value,
    )
    .join('');
}
