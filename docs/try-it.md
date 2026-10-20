---
title: Try it
description: Send API requests from your documentation, with editable fields and live responses.
---

Every OpenAPI operation has a **Try it** button in its endpoint bar. It opens a request form beside the reference. On smaller screens, the form sits below the endpoint. **Done** returns to the examples.

Edit the fields, choose a server, and press **Send request**. The response shows the HTTP status, time, size, body, and headers available to the browser. HTTP errors appear as responses too. You can cancel a request while it is running.

**View request**, below Send, opens the matching code sample. Its language choices follow your existing `codeSamples` configuration. Credentials are replaced with placeholders unless you select **Include credentials in the preview and copied code**.

The console loads when someone opens it. Opening a page or restoring a draft never sends an API request.

## Configuration

Try it is enabled by default. Disable it for the whole site with `tryIt: false`, or override the setting for an individual OpenAPI tab:

```ts
import { defineConfig, openapi } from "sourcey";

export default defineConfig({
  tryIt: false,
  navigation: {
    tabs: [
      {
        tab: "API Reference",
        source: openapi("./openapi.yaml"),
        tryIt: { credentials: "same-origin" },
      },
    ],
  },
});
```

`credentials` controls browser-managed cookies and session credentials:

| Value         | Behaviour                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `same-origin` | Default. Browser sessions are used when the API and docs have the same origin.                                                      |
| `include`     | Allow browser sessions for requests to another origin too. The API must permit credentialed requests from the documentation origin. |
| `omit`        | Send no browser-managed session credentials. Explicit API keys or tokens still follow the selected security scheme.                 |

Use `include` only on a reference that needs it. It does not sign a reader in or make blocked cookies available.

## Fields and authentication

The form uses the operation's parameters, body media types, examples, schemas, and servers. It supports defined objects, arrays, alternatives, enums, JSON and text bodies, URL-encoded forms, and multipart file uploads. **Edit JSON** opens the complete JSON payload, including additional properties; **Use fields** returns to the structured form. Optional fields can be unset; an unset value differs from `false`, `0`, an empty string, or `null`.

Before sending, the console checks required fields, types, allowed values, numeric and text limits, array constraints, and additional properties. Constraints on composed schemas apply alongside their individual branches. Format annotations other than binary are not fully validated by the console.

Authentication follows the API description. Choose among alternative security requirements; multiple schemes in one requirement are used together. API keys, Basic authentication, and existing bearer or OAuth access tokens are supported. Cookie authentication uses the browser's existing session. OAuth sign-in flows and raw binary request bodies are not provided.

Requests run directly from the browser. The API needs to allow access from the docs origin, and an HTTPS documentation page needs an HTTPS API. Browsers control headers such as `Cookie`, `Host`, and `Origin`; the console explains when a request cannot be expressed by browser fetch. A failed fetch alone cannot identify the cause.

## Local drafts

Non-sensitive, schema-defined fields are cached in localStorage for up to 30 days, scoped to the documentation page, API, version, and operation. Server selection is restored with the draft. **Reset** returns fields to the API examples and defaults.

Authentication, recognised secret fields, password and write-only fields, files, free-form objects, and responses are not stored. Credentials stay in the open page's memory; changing servers clears the operation's authentication. When browser storage is unavailable, the form still works for the current page.

Password and write-only annotations also apply inside composed schemas. Opening an older draft removes its cache entry if it contains fields that are now excluded; the safe fields remain available in the form. Reset clears the saved draft until you edit a field again.

## Styling

All four themes use the same form primitives and inherit the site's fonts and colours. Custom theme CSS loads after Sourcey's styles. Set variables globally to tune every console:

Main desktop controls share the header search's 36px height and 8px corners. Toolbar controls use 32px; touch controls are at least 44px, with 16px input text. Selects keep native selection behaviour with one theme-aware chevron.

```css
:root {
  --sourcey-form-radius: 0.375rem;
  --sourcey-form-height: 2.875rem;
  --sourcey-form-padding: 0.75rem;
}

.sourcey-input,
.sourcey-select {
  border-width: 1px;
}

.dark {
  --sourcey-form-background: rgb(var(--color-background-dark));
}
```

Public hooks are `.sourcey-field`, `.sourcey-label`, `.sourcey-input`, `.sourcey-select`, `.sourcey-select-wrap`, `.sourcey-select-caret`, `.sourcey-button`, `.sourcey-help`, and `.sourcey-error`. Variables cover `background`, `ink`, `muted`, `border`, `hover`, `accent`, `focus`, `error`, `success`, `radius`, `height`, `height-small`, `padding`, `font`, `font-size`, and `font-size-small`, under the `--sourcey-form-` prefix. Override `--sourcey-control-height` and `--sourcey-control-radius` to change both header search and forms; the `--sourcey-form-` variables affect forms alone. There is no shadow DOM or `!important` rule to work around.

## Keyboard and response handling

Use Tab to move through the form, Ctrl/⌘+Enter to send, and Escape to close it. Closing returns focus to **Try it** and cancels an outstanding request. Response tabs support the arrow keys.

JSON responses can be viewed as pretty or raw text. HTML remains text. Large responses show a 64 KB preview and a download link; capture stops at 10 MB, and a truncated download is clearly marked. Binary responses have a download action.
