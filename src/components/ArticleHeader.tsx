import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { Palette } from '../ui/palette';
import { ArticleControls } from './ArticleControls';

/** The header's own height below the safe area. Fixed, so the page's top inset is known before the page starts. */
export const ARTICLE_HEADER_BAR_HEIGHT = 52;

type Props = {
  articleId: string | null;
  palette: Palette;
  /** The safe area at the top of the screen (status bar, notch). The header reaches up into it. */
  safeTop: number;
  onBack: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * The article's native header. It floats over the page, which scrolls underneath it: the page reserves the header's
 * height itself (`app:insets`), so the title starts just below it.
 */
export function ArticleHeader({ articleId, palette, safeTop, onBack, style }: Props) {
  return (
    <View
      style={[
        styles.header,
        { paddingTop: safeTop, height: safeTop + ARTICLE_HEADER_BAR_HEIGHT },
        { backgroundColor: palette.chrome, borderBottomColor: palette.rule },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Text style={[styles.backLabel, { color: palette.action }]}>‹ Back</Text>
      </Pressable>
      <ArticleControls articleId={articleId} palette={palette} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { height: 40, paddingHorizontal: 8, justifyContent: 'center' },
  backLabel: { fontSize: 17, fontWeight: '500' },
  pressed: { opacity: 0.5 },
});
