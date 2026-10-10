import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Linking } from 'react-native';

import { pageUrl } from '../config';
import { assertNever } from '../util/assertNever';
import { articlePathOf, createOpenGate, routeOf } from './links';
import type { RootStackParamList } from './types';

export type OpenLinks = {
  /** An article path the app made itself (the Recently read strip). Through the same gate as the page's links. */
  openArticle: (path: string) => void;
  /** A link the page tried to follow (`onLeavePage`): an article gets a screen, anything else the OS. */
  openUrl: (url: string) => void;
  /** The page's `openArticle` message. `path` is untrusted: only an article path on our server opens a screen. */
  openArticleMessage: (path: string) => void;
};

/**
 * The one place a screen turns links and `openArticle` into navigation. Both ways into an article go through the same
 * gate, so the "Link + message" teaser pushes exactly one screen (Q6).
 */
export function useOpenLinks(): OpenLinks {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [mayOpen] = useState(() => createOpenGate());

  const openArticle = useCallback(
    (path: string) => {
      if (mayOpen(path)) navigation.push('Article', { path });
    },
    [navigation, mayOpen],
  );

  const openUrl = useCallback(
    (url: string) => {
      const route = routeOf(url);
      switch (route.kind) {
        case 'article':
          openArticle(route.path);
          return;
        case 'external':
          Linking.openURL(route.url).catch((error: unknown) => {
            console.warn(`no app could open ${route.url}`, error);
          });
          return;
        default:
          assertNever(route, 'link route');
      }
    },
    [openArticle],
  );

  const openArticleMessage = useCallback(
    (path: string) => {
      const articlePath = articlePathOf(pageUrl(path));
      if (articlePath === null) console.warn(`ignored openArticle for ${path}: not an article`);
      else openArticle(articlePath);
    },
    [openArticle],
  );

  return { openArticle, openUrl, openArticleMessage };
}
