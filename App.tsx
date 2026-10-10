import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startConsent } from './src/consent/consentService';
import type { RootStackParamList } from './src/navigation/types';
import { ArticleScreen } from './src/screens/ArticleScreen';
import { FrontScreen } from './src/screens/FrontScreen';
import { hydrateAppState, useAppState } from './src/state/appState';
import { hydrateFrontCache } from './src/state/frontCache';
import { startTrackingOnConsent } from './src/tracking/appTracking';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  // No page may become ready before the saved app state is loaded (see `hydrateAppState`). The front screen also
  // starts from its saved height.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void Promise.all([hydrateAppState(), hydrateFrontCache()]).then(() => setHydrated(true));
  }, []);

  // At launch, not after hydration: the five seconds the pages may wait for consent start now. The tracker is created
  // the moment consent is a string; events from before wait in `tracking`.
  useEffect(() => {
    const stopTracking = startTrackingOnConsent();
    const stopConsent = startConsent();

    return () => {
      stopConsent();
      stopTracking();
    };
  }, []);

  if (!hydrated) return null;

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Front" component={FrontScreen} options={{ title: 'News' }} />
          <Stack.Screen name="Article" component={ArticleScreen} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
      <ThemedStatusBar />
    </SafeAreaProvider>
  );
}

/** Both headers take the app's theme, so the status bar above them does too. */
function ThemedStatusBar() {
  const theme = useAppState(state => state.theme);

  return <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />;
}
