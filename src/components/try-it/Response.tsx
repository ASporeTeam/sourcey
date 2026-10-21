import { useEffect, useState } from "preact/hooks";
import type { ConsoleResponse } from "./transport.js";

export function CopyAction({ text, label = "Copy" }: { text: string; label?: string }) {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(() => setMessage(""), 1800);
    return () => clearTimeout(timeout);
  }, [message]);
  return (
    <button
      type="button"
      class="sourcey-button sourcey-button-quiet"
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setMessage("Copied");
        } catch {
          setMessage("Select and copy the text");
        }
      }}
    >
      {message || label}
    </button>
  );
}

export function ResponseView({
  response,
  stale,
  id,
  headingLevel = 3,
}: {
  response: ConsoleResponse;
  stale: boolean;
  id: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const [tab, setTab] = useState("body");
  const [raw, setRaw] = useState(false);
  const [text, setText] = useState("");
  const [download, setDownload] = useState("");
  const binary =
    !!response.blob.type &&
    !/json|text|xml|javascript|x-www-form-urlencoded/i.test(response.blob.type);
  const limited = response.blob.size > 64_000;
  useEffect(() => {
    let current = true;
    setText("");
    const url = URL.createObjectURL(response.blob);
    setDownload(url);
    if (!binary)
      response.blob
        .slice(0, 64_000)
        .text()
        .then((value) => {
          if (current) setText(value);
        });
    return () => {
      current = false;
      URL.revokeObjectURL(url);
    };
  }, [response, binary]);
  let formatted = text;
  if (!raw && !limited) {
    try {
      formatted = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* Plain text remains plain text. */
    }
  }
  const body =
    tab === "headers" ? response.headers.map(([k, v]) => k + ": " + v).join("\n") : formatted;
  const statusClass = response.status >= 400 ? "tryit-status-error" : "tryit-status-ok";
  return (
    <section class="tryit-response" aria-label="Live response">
      <div class="tryit-heading">
        <Heading>Response</Heading>
        <div class="tryit-response-meta">
          <span class={"tryit-status " + statusClass}>
            {response.status} {response.statusText}
          </span>
          <span>
            {response.duration} ms ·{" "}
            {response.blob.size < 1024
              ? response.blob.size + " B"
              : (response.blob.size / 1024).toFixed(1) + " KB"}
          </span>
        </div>
      </div>
      {stale && (
        <p class="sourcey-help">Inputs changed. This is the response to your previous request.</p>
      )}
      <div class="tryit-response-tools">
        <div class="tryit-tabs" role="tablist" aria-label="Response view">
          {["body", "headers"].map((name) => (
            <button
              type="button"
              role="tab"
              id={id + "-tab-" + name}
              aria-controls={id + "-response-panel"}
              aria-selected={tab === name}
              tabIndex={tab === name ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  setTab(tab === "body" ? "headers" : "body");
                  const parent = e.currentTarget.parentElement;
                  requestAnimationFrame(() =>
                    parent?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(),
                  );
                }
              }}
              onClick={() => setTab(name)}
            >
              {name === "body" ? "Body" : "Headers"}
            </button>
          ))}
        </div>
        {tab === "body" && !binary && (
          <button
            type="button"
            class="sourcey-button sourcey-button-quiet"
            aria-pressed={raw}
            onClick={() => setRaw(!raw)}
          >
            {raw ? "Pretty" : "Raw"}
          </button>
        )}
        {!binary && (
          <CopyAction
            text={tab === "headers" ? body : text}
            label={limited ? "Copy preview" : "Copy"}
          />
        )}
      </div>
      <div
        role="tabpanel"
        id={id + "-response-panel"}
        aria-labelledby={id + "-tab-" + tab}
        tabIndex={0}
        class="tryit-response-body"
      >
        {binary && tab === "body" ? (
          <p>Binary response · {response.blob.type}</p>
        ) : !response.blob.size && tab === "body" ? (
          <p>No response body.</p>
        ) : (
          <pre>
            <code>{body}</code>
          </pre>
        )}
      </div>
      {(limited || binary) && (
        <div class="tryit-response-download">
          <p class="sourcey-help">
            {response.truncated
              ? "Stopped at the 10 MB response limit. Download contains the captured portion."
              : limited
                ? "Showing the first 64 KB. Download the complete response."
                : "Download the response to open this file."}
          </p>
          <a
            class="sourcey-button sourcey-button-quiet"
            href={download}
            download={response.truncated ? "response-partial" : "response"}
          >
            Download{response.truncated ? " captured response" : " response"}
          </a>
        </div>
      )}
      <p class="tryit-response-origin">
        Received from <code>{new URL(response.url).host}</code>
      </p>
    </section>
  );
}
