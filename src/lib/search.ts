/**
 * Returns search variants for Arabic-normalized search.
 * Normalizes hamza/alef variants (أ إ آ → ا) and generates reverse variants
 * for word-initial and after-ل positions to handle bidirectional matching.
 */
export function getArabicSearchTerms(query: string): string[] {
  const normalized = query.replace(/[أإآ]/g, "ا");
  const terms = new Set<string>([query, normalized]);

  const chars = [...normalized];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "ا" && (i === 0 || chars[i - 1] === " " || chars[i - 1] === "ل")) {
      for (const h of ["أ", "إ", "آ"]) {
        terms.add(chars.slice(0, i).join("") + h + chars.slice(i + 1).join(""));
      }
    }
  }

  return [...terms];
}
