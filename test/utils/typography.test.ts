import { describe, expect, it } from "vitest";
import { smartypants } from "../../src/utils/typography.js";

describe("smartypants", () => {
  it("curls quotes and joins dashes and ellipses in text, never in a tag", () => {
    expect(smartypants(`<p>&quot;Don&#39;t panic,&quot; she said -- it&#39;s the &#39;90s... <a href="a--b" title="&quot;x&quot;">&#39;quoted&#39;</a></p>`))
      .toBe(`<p>“Don’t panic,” she said — it’s the ’90s… <a href="a--b" title="&quot;x&quot;">‘quoted’</a></p>`);
  });

  it("keeps code and preformatted text as written", () => {
    const html = `<p>Run <code>--load-only &quot;en&quot;</code></p><pre><code>it&#39;s -- raw...</code></pre><p>it&#39;s</p>`;
    expect(smartypants(html)).toBe(`<p>Run <code>--load-only &quot;en&quot;</code></p><pre><code>it&#39;s -- raw...</code></pre><p>it’s</p>`);
  });

  it("opens and closes a quote beside inline markup", () => {
    expect(smartypants(`<p>Say <strong>&quot;hi&quot;</strong> and &quot;<em>bye</em>&quot;.</p><p>&quot;Next&quot;</p>`))
      .toBe(`<p>Say <strong>“hi”</strong> and “<em>bye</em>”.</p><p>“Next”</p>`);
  });
});
