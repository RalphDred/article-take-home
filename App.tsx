import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { RootStackParamList } from './src/navigation/types';
import { ArticleScreen } from './src/screens/ArticleScreen';
import { FrontScreen } from './src/screens/FrontScreen';
import { hydrateAppState } from './src/state/appState';
import { hydrateFrontCache } from './src/state/frontCache';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  // No page may become ready before the saved app state is loaded (see `hydrateAppState`). The front screen also
  // starts from its saved height.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void Promise.all([hydrateAppState(), hydrateFrontCache()]).then(() => setHydrated(true));
  }, []);

  if (!hydrated) return null;

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Front" component={FrontScreen} options={{ title: 'News' }} />
          <Stack.Screen name="Article" component={ArticleScreen} options={{ title: '' }} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
