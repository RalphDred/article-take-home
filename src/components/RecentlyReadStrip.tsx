import { useEffect } from 'react';
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { requestTitles, useFrontCache } from '../state/frontCache';
import type { Palette } from '../ui/palette';

type Props = {
  /** Most recent first, at most five (`recentlyRead`). The strip is not drawn while it is empty. */
  articleIds: readonly string[];
  palette: Palette;
  onOpen: (articleId: string) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

/** The native "Recently read" strip above the front page. */
export function RecentlyReadStrip({ articleIds, palette, onOpen, onLayout }: Props) {
  const titles = useFrontCache(state => state.titles);

  useEffect(() => {
    requestTitles(articleIds);
  }, [articleIds]);

  if (articleIds.length === 0) return null;

  return (
    <View onLayout={onLayout} style={[styles.strip, { borderBottomColor: palette.rule }]}>
      <Text style={[styles.heading, { color: palette.muted }]}>Recently read</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {articleIds.map(id => {
          const title = titles[id];

          return (
            <Pressable
              key={id}
              accessibilityRole="link"
              accessibilityLabel={title ?? `Article ${id}`}
              onPress={() => onOpen(id)}
              style={({ pressed }) => [styles.card, { backgroundColor: palette.tint }, pressed && styles.pressed]}
            >
              <Text numberOfLines={3} style={[styles.title, { color: title ? palette.text : palette.muted }]}>
                {title ?? `Article ${id}`}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { paddingTop: 12, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: {
    paddingHorizontal: 16,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  row: { paddingHorizontal: 16, gap: 10 },
  card: { width: 180, minHeight: 72, padding: 12, borderRadius: 8, justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
});
