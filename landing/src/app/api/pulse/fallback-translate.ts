/**
 * Fallback translation for mixed-language titles
 * Splits "English Title：中文说明" format
 */

export function splitMixedTitle(title: string): { en: string; zh: string } {
  // Check for Chinese colon (：) or English colon (:)
  const colonMatch = title.match(/^([^:：]+)[：:](.+)$/);

  if (colonMatch) {
    const [, part1, part2] = colonMatch;

    // Detect which part is English and which is Chinese
    const hasChinese1 = /[一-龥]/.test(part1);
    const hasChinese2 = /[一-龥]/.test(part2);

    if (!hasChinese1 && hasChinese2) {
      // Part1 is English, Part2 is Chinese
      return { en: part1.trim(), zh: part2.trim() };
    } else if (hasChinese1 && !hasChinese2) {
      // Part1 is Chinese, Part2 is English
      return { en: part2.trim(), zh: part1.trim() };
    }
  }

  // Fallback: return original for both
  return { en: title, zh: title };
}

/**
 * Simple translation fallback when API fails
 */
export function fallbackTranslate(titles: string[]): { en: string[]; zh: string[] } {
  const en: string[] = [];
  const zh: string[] = [];

  titles.forEach(title => {
    const split = splitMixedTitle(title);
    en.push(split.en);
    zh.push(split.zh);
  });

  return { en, zh };
}
