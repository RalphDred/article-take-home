import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';

import { savedLibrary, useSaved } from '../offline/savedLibrary';
import type { Palette } from '../ui/palette';

type Props = { articleId: string; palette: Palette };

/**
 * Save for offline reading. While the copy downloads it shows its progress, and a tap cancels. Once saved, a tap
 * offers to remove the copy. (A background update of a saved copy does not show here: the copy is saved throughout.)
 */
export function SaveControl({ articleId, palette }: Props) {
  const saved = useSaved(state => state.copies[articleId] !== undefined);
  const download = useSaved(state => state.downloads[articleId]);

  if (download?.kind === 'save') {
    const progress = download.total > 0 ? `${download.done}/${download.total}` : '';

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Saving for offline reading${progress ? `, ${progress} files` : ''}. Cancel`}
        hitSlop={6}
        onPress={() => savedLibrary.cancel(articleId)}
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      >
        <ActivityIndicator size="small" color={palette.text} />
        <Text style={[styles.progress, { color: palette.muted }]}>{progress || '…'} ✕</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Saved for offline reading. Remove' : 'Save for offline reading'}
      accessibilityState={{ selected: saved }}
      hitSlop={6}
      onPress={() => (saved ? confirmRemove(articleId) : savedLibrary.save(articleId))}
      style={({ pressed }) => [styles.control, pressed && styles.pressed]}
    >
      <Text style={[styles.label, { color: saved ? palette.action : palette.text }]}>{saved ? 'Saved' : 'Save'}</Text>
    </Pressable>
  );
}

function confirmRemove(articleId: string) {
  Alert.alert('Remove the saved copy?', 'The article will need a connection again.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => void savedLibrary.remove(articleId) },
  ]);
}

const styles = StyleSheet.create({
  // One width in every state, so the header's other buttons never move while a copy downloads.
  control: {
    width: 76,
    height: 40,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 20,
  },
  pressed: { opacity: 0.5 },
  label: { fontSize: 15, fontWeight: '600' },
  progress: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
