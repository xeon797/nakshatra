/**
 * Fact Checker Agent Facade
 * Provides claim verification against primary documents and secondary web corroboration via Tavily.
 */

export {
  FactVerificationAgent,
  FactVerificationAgent as FactCheckerAgent,
  VerificationVerdictSchema,
  type VerificationVerdict,
  type SourceDocument,
  type VerifiedClaimOutcome,
} from './fact-verifier';
