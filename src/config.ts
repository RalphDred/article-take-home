import Constants from 'expo-constants';
import { Dimensions, Platform } from 'react-native';

import type { Platform as TrackerPlatform } from '../sdk/tracker';

const PORT = 8787;

/**
 * Where the fixture server lives, in order of preference:
 * 1. `EXPO_PUBLIC_SERVER_URL`, for a device that cannot reach the dev machine by the Metro host (or a custom port).
 * 2. The host Metro is served from. In Expo Go on a phone or tablet this is the dev machine's Wi-Fi address,
 *    which is also where the fixture server listens (it binds 0.0.0.0).
 * 3. The emulator/simulator defaults from the README: `10.0.2.2` on Android, `localhost` on iOS.
 */
function resolveServerUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_SERVER_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (metroHost) return `http://${metroHost}:${PORT}`;

  return Platform.OS === 'android' ? `http://10.0.2.2:${PORT}` : `http://localhost:${PORT}`;
}

export const SERVER_URL = resolveServerUrl();

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

export const APP_BUILD =
  Platform.OS === 'ios'
    ? (Constants.expoConfig?.ios?.buildNumber ?? '0')
    : String(Constants.expoConfig?.android?.versionCode ?? 0);

export const PLATFORM: TrackerPlatform = Platform.OS === 'ios' ? 'ios' : 'android';

function deviceType(): 'phone' | 'tablet' {
  if (Platform.OS === 'ios') return Platform.isPad ? 'tablet' : 'phone';

  const { width, height } = Dimensions.get('screen');
  return Math.min(width, height) >= 600 ? 'tablet' : 'phone';
}

/** `window.appContext`: set before every page starts. The web tracker adds it to every event. */
export const APP_CONTEXT = {
  appVersion: APP_VERSION,
  appBuild: APP_BUILD,
  os: PLATFORM,
  deviceType: deviceType(),
} as const;

export type AppContext = typeof APP_CONTEXT;

export const TRACKER_NAMESPACE = 'news-app';

export const pageUrl = (path: string): string => `${SERVER_URL}${path.startsWith('/') ? path : `/${path}`}`;
