// When an article counts as read (README, "Reading"; PLAN Q13).
//
// Once each time an article screen is opened, never twice for the same screen. A pull to refresh, a retry or a
// rebuild after the content process died is the same screen: its new document may report the end of the text again,
// and that is not a second read. Opening the article again later is a new screen, with a new counter.

/** Calls `onRead` the first time this screen's article reaches the end of its text. Returns whether it counted. */
export function createReadCounter(onRead: (articleId: string) => void): (articleId: string) => boolean {
  let counted = false;

  return articleId => {
    if (counted) return false;

    counted = true;
    onRead(articleId);
    return true;
  };
}
