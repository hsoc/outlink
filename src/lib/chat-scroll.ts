/** True when new messages should follow the reader rather than stealing their scroll position. */
export function isChatAtLatest(viewportHeight: number, scrollY: number, contentHeight: number, threshold: number): boolean {
  return viewportHeight + scrollY >= contentHeight - threshold;
}
