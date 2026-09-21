/**
 * Who may open OLD INDENT TO PO.
 *
 * Aksha, 21 Sep 2026: "I want Indent to PO (which was in V1 - it was very
 * helpful for me to check all Projects in one screen) ... can u make which is
 * only visible to me only - name it OLD INDENT TO PO".
 *
 * ONE rule, shared by the lane in the sidebar and the page's own refusal. The
 * Stores lesson, written down: hiding a lane was never the whole gate, and two
 * copies of "who may see this" is how a section ends up one typed URL wide.
 *
 * `admin` is how the hub says "only Aksha" — there is exactly one active admin
 * account (projectexecution@construction.srmd.org); everybody else is head,
 * founder, backoffice or engineer. If a second admin is ever made they would
 * see this too, which is the same bargain every other admin-only screen takes.
 */
export function canSeeOldIndentToPo(role: string | null | undefined): boolean {
  return role === 'admin'
}

/** The restored V1 file. It lives in public/ but is NOT public: the proxy's
 *  matcher deliberately does not exclude .html, so it needs a signed-in
 *  session like every other page — see the comment at the foot of proxy.ts. */
export const OLD_INDENT_TO_PO_SRC = '/old-indent-to-po.html'
