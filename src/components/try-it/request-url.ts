/** A request URL in the parts a narrow screen may break between: the origin, each path segment, the query and each further parameter. */
export function requestUrlParts(url: string): string[] {
  const origin = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i)?.[0] ?? "";
  return [origin, ...url.slice(origin.length).split(/(?=[/?&])/)].filter(Boolean);
}

/**
 * The live request URL in the endpoint's place, as one run of text that a
 * narrow screen breaks between its parts rather than inside a word.
 */
export function showRequestUrl(element: Element, url: string): void {
  const run = document.createElement("span");
  requestUrlParts(url).forEach((part, index) => {
    if (index) run.append(document.createElement("wbr"));
    run.append(part);
  });
  element.replaceChildren(run);
}
