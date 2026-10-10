import * as sdk from '../../sdk/tracker';
import { consentStringOf, type ConsentState } from '../consent/consent';
import { useConsent } from '../consent/consentService';
import { APP_VERSION, PLATFORM, SERVER_URL, TRACKER_NAMESPACE } from '../config';
import { createTracking } from './tracking';

/** The app's one tracking pipeline. Every page and screen tracks through it, before consent and after. */
export const tracking = createTracking(sdk, {
  namespace: TRACKER_NAMESPACE,
  endpoint: SERVER_URL,
  appVersion: APP_VERSION,
  platform: PLATFORM,
});

/**
 * Creates the tracker as soon as `/consent` has answered with a consent string, and never before: not on a failure,
 * not on five seconds without an answer, not on `null`. Returns the unsubscribe.
 */
export function startTrackingOnConsent(): () => void {
  const startIfGiven = (state: ConsentState) => {
    if (consentStringOf(state) !== null) tracking.start();
  };

  startIfGiven(useConsent.getState().state);

  return useConsent.subscribe(store => startIfGiven(store.state));
}
