import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { APP_CONTEXT, pageUrl, SERVER_URL } from './src/config';

// Phase 0 spike: prove that /front renders in a web view on both platforms. Replaced by the real screens later.
const BEFORE_CONTENT = `window.appContext = ${JSON.stringify(APP_CONTEXT)}; true;`;

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <Text style={styles.caption}>{SERVER_URL}</Text>
        <View style={styles.page}>
          <WebView
            source={{ uri: pageUrl('/front') }}
            injectedJavaScriptBeforeContentLoaded={BEFORE_CONTENT}
            onMessage={event => console.log('[page]', event.nativeEvent.data)}
            onError={event => console.warn('[webview] error', event.nativeEvent.description)}
          />
        </View>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  caption: { fontSize: 12, padding: 8, color: '#666' },
  page: { flex: 1 },
});
