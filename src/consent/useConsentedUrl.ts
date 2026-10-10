import { pageConsentOf, withConsent } from './consent';
import { useConsent } from './consentService';

/**
 * The URL an online page loads with: null while the app still waits for consent (up to five seconds at launch), then
 * the page's URL with `#consent=<value>`, or without a fragment when there is no consent string. It changes whenever
 * the consent string does; `usePageLoad` decides what a change means for an open page.
 */
export function useConsentedUrl(url: string): string | null {
  const consent = pageConsentOf(useConsent(store => store.state));

  return consent.known ? withConsent(url, consent.value) : null;
}
