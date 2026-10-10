import { useIsFocused } from '@react-navigation/native';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ScreenProps } from '../navigation/types';
import { useOpenLinks } from '../navigation/useOpenLinks';
import type { SavedCopy } from '../offline/library';
import type { FolderSizes } from '../offline/savedFs';
import { savedLibrary, useSaved } from '../offline/savedLibrary';
import { useAppState } from '../state/appState';
import { type Palette, paletteOf } from '../ui/palette';

/**
 * The saved articles (version, size, when saved) and the downloads in progress. Each can be deleted or cancelled,
 * and the header deletes everything. Works without the server: nothing here needs the network.
 *
 * The folder's file count and bytes are measured on disk each time the screen is shown (and when a copy comes or
 * goes while it is), not taken from the app's own records. So is each copy's size.
 */
export function SavedScreen({ navigation }: ScreenProps<'Saved'>) {
  const palette = paletteOf(useAppState(state => state.theme));
  const copies = useSaved(state => state.copies);
  const downloads = useSaved(state => state.downloads);
  const { openArticle } = useOpenLinks();

  const savedList = useMemo(() => Object.values(copies).sort((a, b) => b.savedAt - a.savedAt), [copies]);
  const downloadList = Object.values(downloads);
  const empty = savedList.length === 0 && downloadList.length === 0;

  const focused = useIsFocused();
  const [sizes, setSizes] = useState<FolderSizes | null>(null);
  useEffect(() => {
    if (!focused) return;

    let current = true;
    savedLibrary
      .measure()
      .then(measured => {
        if (current) setSizes(measured);
      })
      .catch((error: unknown) => console.warn('[saved] could not measure the saved-articles folder', error));

    return () => {
      current = false;
    };
  }, [focused, copies]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: palette.background },
      headerTintColor: palette.text,
      headerRight: () => (
        <Pressable accessibilityRole="button" hitSlop={8} disabled={empty} onPress={confirmDeleteAll}>
          <Text style={[styles.headerButton, { color: empty ? palette.muted : palette.action }]}>Delete all</Text>
        </Pressable>
      ),
    });
  }, [navigation, palette, empty]);

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
      {downloadList.length > 0 && (
        <Section title="Downloading" palette={palette}>
          {downloadList.map(download => (
            <Row
              key={download.articleId}
              palette={palette}
              title={download.title ?? `Article ${download.articleId}`}
              detail={`${download.kind === 'update' ? 'Updating' : 'Saving'} · ${
                download.total > 0 ? `${download.done} of ${download.total} files` : 'starting'
              }`}
              action="Cancel"
              onAction={() => savedLibrary.cancel(download.articleId)}
            />
          ))}
        </Section>
      )}

      {savedList.length > 0 && (
        <Section title="Saved articles" palette={palette}>
          {savedList.map(copy => (
            <Row
              key={copy.articleId}
              palette={palette}
              title={copy.title}
              detail={describeCopy(copy, sizes)}
              action="Delete"
              onPress={() => openArticle(`/article/${copy.articleId}?ref=saved`)}
              onAction={() => void savedLibrary.remove(copy.articleId)}
            />
          ))}
        </Section>
      )}

      {empty && (
        <Text style={[styles.empty, { color: palette.muted }]}>
          Nothing saved yet. Tap Save on an article to read it without a connection.
        </Text>
      )}

      <Text style={[styles.footer, { color: palette.muted, borderTopColor: palette.rule }]}>
        {sizes === null
          ? 'Measuring the saved-articles folder…'
          : `Saved-articles folder on this device: ${sizes.files} ${sizes.files === 1 ? 'file' : 'files'}, ${formatBytes(sizes.bytes)}.`}
      </Text>
    </ScrollView>
  );
}

function describeCopy(copy: SavedCopy, sizes: FolderSizes | null): string {
  const bytes = sizes?.byFolder[copy.uri];
  const parts = [`Version ${copy.version}`, bytes === undefined ? null : formatBytes(bytes), `saved ${formatTime(copy.savedAt)}`];
  if (copy.downloadedAt !== copy.savedAt) parts.push(`updated ${formatTime(copy.downloadedAt)}`);

  return parts.filter(part => part !== null).join(' · ');
}

function confirmDeleteAll() {
  Alert.alert('Delete every saved article?', 'Downloads in progress are cancelled too.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Delete all', style: 'destructive', onPress: () => void savedLibrary.removeAll() },
  ]);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const formatTime = (at: number): string =>
  new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Section({ title, palette, children }: { title: string; palette: Palette; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.muted }]}>{title}</Text>
      {children}
    </View>
  );
}

type RowProps = {
  palette: Palette;
  title: string;
  detail: string;
  action: string;
  onAction: () => void;
  onPress?: () => void;
};

function Row({ palette, title, detail, action, onAction, onPress }: RowProps) {
  return (
    <View style={[styles.row, { borderBottomColor: palette.rule }]}>
      <Pressable
        accessibilityRole={onPress ? 'link' : 'text'}
        disabled={onPress === undefined}
        onPress={onPress}
        style={({ pressed }) => [styles.rowText, pressed && styles.pressed]}
      >
        <Text numberOfLines={2} style={[styles.title, { color: palette.text }]}>
          {title}
        </Text>
        <Text style={[styles.detail, { color: palette.muted }]}>{detail}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${action}: ${title}`}
        hitSlop={8}
        onPress={onAction}
        style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
      >
        <Text style={[styles.actionLabel, { color: palette.action }]}>{action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40 },
  headerButton: { fontSize: 16, fontWeight: '600' },
  section: { paddingTop: 16 },
  sectionTitle: {
    paddingHorizontal: 16,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 4 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  detail: { fontSize: 13 },
  rowAction: { paddingVertical: 6 },
  actionLabel: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.5 },
  empty: { padding: 24, fontSize: 15, textAlign: 'center' },
  footer: { marginTop: 24, paddingHorizontal: 16, paddingTop: 16, fontSize: 13, borderTopWidth: StyleSheet.hairlineWidth },
});
