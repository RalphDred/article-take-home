import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FONT_SCALE, useAppState } from '../state/appState';
import type { Palette } from '../ui/palette';

type Props = { articleId: string | null; palette: Palette };

/** Font size − and +, the light/dark switch and the bookmark star. Each tap is one change to the app state. */
export function ArticleControls({ articleId, palette }: Props) {
  const fontScale = useAppState(state => state.fontScale);
  const theme = useAppState(state => state.theme);
  const bookmarked = useAppState(state => articleId !== null && state.bookmarks.includes(articleId));
  const { stepFontScale, toggleTheme, toggleBookmark } = useAppState.getState();

  return (
    <View style={styles.row}>
      <Control
        label="A−"
        accessibilityLabel="Smaller text"
        color={palette.text}
        disabled={fontScale <= FONT_SCALE.min}
        onPress={() => stepFontScale(-1)}
      />
      <Control
        label="A+"
        accessibilityLabel="Larger text"
        color={palette.text}
        disabled={fontScale >= FONT_SCALE.max}
        onPress={() => stepFontScale(1)}
      />
      <Control
        label={theme === 'dark' ? '☀︎' : '☾'}
        accessibilityLabel={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        color={palette.text}
        onPress={toggleTheme}
      />
      {articleId !== null && (
        <Control
          label={bookmarked ? '★' : '☆'}
          accessibilityLabel={bookmarked ? 'Remove bookmark' : 'Bookmark'}
          accessibilityState={{ selected: bookmarked }}
          color={bookmarked ? palette.action : palette.text}
          onPress={() => toggleBookmark(articleId)}
        />
      )}
    </View>
  );
}

type ControlProps = {
  label: string;
  accessibilityLabel: string;
  accessibilityState?: { selected: boolean };
  color: string;
  disabled?: boolean;
  onPress: () => void;
};

function Control({ label, accessibilityLabel, accessibilityState, color, disabled = false, onPress }: ControlProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.control, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  control: { minWidth: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  pressed: { opacity: 0.5 },
  disabled: { opacity: 0.3 },
  label: { fontSize: 19 },
});
