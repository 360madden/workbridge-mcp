import { PlanError } from './plan.mjs';
import { RIFT_ACTIONS, RIFT_BUNDLE_VERIFIERS, preflightRiftSources } from './adapters/rift.mjs';
import { STAR_WRATH_PROVIDER } from './adapters/starwrath.mjs';

/**
 * First-party, reviewed, sealed providers. The plan selects an ID, never a
 * JavaScript module, executable path, shell command, or arbitrary callback.
 */
export const BUILTIN_RESEARCH_PROVIDERS = Object.freeze({
  'rift.offline.v1': Object.freeze({
    actions: RIFT_ACTIONS,
    verifiers: RIFT_BUNDLE_VERIFIERS,
    preflight: preflightRiftSources,
  }),
  'starwrath.offline.v1': STAR_WRATH_PROVIDER,
});

export function researchProvider(profile) {
  const provider = Object.hasOwn(BUILTIN_RESEARCH_PROVIDERS, profile)
    ? BUILTIN_RESEARCH_PROVIDERS[profile]
    : null;
  if (!provider)
    throw new PlanError(
      'ADAPTER_UNAVAILABLE',
      'No reviewed implementation is installed for this research profile.',
    );
  return provider;
}
