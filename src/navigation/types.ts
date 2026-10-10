import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Front: undefined;
  /** `path` is the article's path on the server, query string included (`/article/2?ref=front`). */
  Article: { path: string };
};

export type ScreenProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;
