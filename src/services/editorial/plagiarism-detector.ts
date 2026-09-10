export interface PlagiarismCheckResult {
  maxSimilarity: number;
  isAcceptable: boolean;
  longestCommonPhraseLength: number;
  offendingPhrases: string[];
}

/**
 * Deterministic N-Gram Anti-Plagiarism Gate.
 * Validates that synthesized content is original reporting and not verbatim copyrighted scraping.
 */
export class PlagiarismDetector {
  private nGramSize: number;
  private maxAllowedSimilarity: number;

  constructor(nGramSize = 5, maxAllowedSimilarity = 0.12) {
    this.nGramSize = nGramSize;
    this.maxAllowedSimilarity = maxAllowedSimilarity;
  }

  /**
   * Tokenizes text into lowercase alphanumeric words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);
  }

  /**
   * Extracts n-grams as string representations
   */
  private extractNGrams(words: string[], n: number): Set<string> {
    const ngrams = new Set<string>();
    for (let i = 0; i <= words.length - n; i++) {
      ngrams.add(words.slice(i, i + n).join(' '));
    }
    return ngrams;
  }

  /**
   * Checks synthesized article text against an array of raw source texts
   */
  check(synthesizedText: string, rawSourceTexts: string[]): PlagiarismCheckResult {
    const synthWords = this.tokenize(synthesizedText);
    if (synthWords.length < this.nGramSize) {
      return {
        maxSimilarity: 0,
        isAcceptable: true,
        longestCommonPhraseLength: 0,
        offendingPhrases: [],
      };
    }

    const synthNGrams = this.extractNGrams(synthWords, this.nGramSize);
    let maxOverlapRatio = 0;
    const allOffendingPhrases: string[] = [];
    const longestPhraseWords = 0;

    for (const sourceText of rawSourceTexts) {
      const sourceWords = this.tokenize(sourceText);
      if (sourceWords.length < this.nGramSize) continue;

      const sourceNGrams = this.extractNGrams(sourceWords, this.nGramSize);
      let commonCount = 0;

      for (const ngram of synthNGrams) {
        if (sourceNGrams.has(ngram)) {
          commonCount++;
          if (allOffendingPhrases.length < 5) {
            allOffendingPhrases.push(ngram);
          }
        }
      }

      const similarity = synthNGrams.size > 0 ? commonCount / synthNGrams.size : 0;
      if (similarity > maxOverlapRatio) {
        maxOverlapRatio = similarity;
      }
    }

    return {
      maxSimilarity: parseFloat(maxOverlapRatio.toFixed(3)),
      isAcceptable: maxOverlapRatio <= this.maxAllowedSimilarity,
      longestCommonPhraseLength: longestPhraseWords,
      offendingPhrases: allOffendingPhrases,
    };
  }
}
