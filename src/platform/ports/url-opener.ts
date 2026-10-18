/** Hand documentation and source links to the OS browser or owning app.
 *
 * Best-effort by contract: implementations never reject, but report whether
 * the operating system accepted the URL so action-local UI can show feedback.
 */
export interface UrlOpenerPort {
  /** Open a URL in the system handler. Resolves false instead of rejecting. */
  openExternalUrl(url: string): Promise<boolean>;
}
