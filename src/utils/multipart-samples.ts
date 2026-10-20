import type { CodeSample } from "../core/types.js";
import type { RequestDescription } from "../core/request.js";
import { codeString, sampleUrl, sampleOrigin } from "./code-literals.js";
const nameOf = (blob: Blob) => ("name" in blob ? String(blob.name) : "upload.bin");

/** Multipart projects logical fields/files; the HTTP client always creates its boundary. */
export function multipartSamples(request: RequestDescription, langs: string[], { originVariable = false }: { originVariable?: boolean } = {}): CodeSample[] {
  if (request.body?.kind !== "multipart") return [];
  const parts = request.body.parts;
  const headers = request.headers.filter(([k]) => k.toLowerCase() !== "content-type");
  return langs.flatMap((lang): CodeSample[] => {
    const q = (value: string) => codeString(value, lang);
    const lines: string[] = [];
    let label: string;
    if (lang === "curl") {
      return [
        {
          lang: "bash",
          label: "cURL",
          source: [
            "curl -X " + request.method + " " + sampleUrl(request.url, lang, originVariable),
            ...headers.map(([k, v]) => "  -H " + q(k + ": " + v)),
            ...parts.map(
              ([k, v]) => (v instanceof Blob ? "  -F " : "  --form-string ") + q(k + "=" + (v instanceof Blob ? "@" + nameOf(v) : v)),
            ),
          ].join(" \\\n").replace(/^/, originVariable ? sampleOrigin(lang) + "\n" : ""),
        },
      ];
    }
    if (lang === "javascript" || lang === "typescript") {
      label = lang === "javascript" ? "JavaScript" : "TypeScript";
      if (originVariable) lines.push(sampleOrigin(lang));
      lines.push("const form = new FormData();");
      for (const [k, v] of parts)
        lines.push(
          "form.append(" + q(k) + ", " + (v instanceof Blob ? "fileInput.files[0]" : q(v)) + ");",
        );
      lines.push(
        "const response = await fetch(" + sampleUrl(request.url, lang, originVariable) + ", {",
        "  method: " + q(request.method) + ",",
        "  headers: " + JSON.stringify(Object.fromEntries(headers)) + ",",
        ...(request.credentials !== "same-origin" ? ["  credentials: " + q(request.credentials) + ","] : []),
        "  body: form,",
        "});",
        "console.log(await response.text());",
      );
    } else if (lang === "python") {
      label = "Python";
      lines.push(
        "import requests",
        "from contextlib import ExitStack",
        "",
        ...(originVariable ? [sampleOrigin(lang)] : []),
        "with ExitStack() as stack:",
        "    files = [",
      );
      for (const [k, v] of parts)
        lines.push(
          "        (" +
            q(k) +
            ", " +
            (v instanceof Blob
              ? "(" + q(nameOf(v)) + ", stack.enter_context(open(" + q(nameOf(v)) + ", 'rb')))"
              : "(None, " + q(v) + ")") +
            "),",
        );
      lines.push(
        "    ]",
        "    response = requests.request(" +
          q(request.method) +
          ", " +
          sampleUrl(request.url, lang, originVariable) +
          ", headers=" +
          JSON.stringify(Object.fromEntries(headers)) +
          ", files=files)",
        "    print(response.text)",
      );
    } else if (lang === "go") {
      label = "Go";
      lines.push(
        "package main",
        'import ("bytes"; "fmt"; "io"; "mime/multipart"; "net/http"' +
          (parts.some(([, v]) => v instanceof Blob) ? '; "os"' : "") +
          ")",
        "func main() {",
        ...(originVariable ? ["  " + sampleOrigin(lang)] : []),
        "  var body bytes.Buffer",
        "  writer := multipart.NewWriter(&body)",
      );
      parts.forEach(([k, v], i) => {
        if (v instanceof Blob)
          lines.push(
            "  file" + i + ", _ := os.Open(" + q(nameOf(v)) + ")",
            "  defer file" + i + ".Close()",
            "  part" + i + ", _ := writer.CreateFormFile(" + q(k) + ", " + q(nameOf(v)) + ")",
            "  io.Copy(part" + i + ", file" + i + ")",
          );
        else lines.push("  writer.WriteField(" + q(k) + ", " + q(v) + ")");
      });
      lines.push(
        "  writer.Close()",
        "  req, _ := http.NewRequest(" + q(request.method) + ", " + sampleUrl(request.url, lang, originVariable) + ", &body)",
        ...headers.map(([k, v]) => "  req.Header.Set(" + q(k) + ", " + q(v) + ")"),
        '  req.Header.Set("Content-Type", writer.FormDataContentType())',
        "  resp, err := http.DefaultClient.Do(req)",
        "  if err != nil { panic(err) }",
        "  defer resp.Body.Close()",
        "  data, _ := io.ReadAll(resp.Body)",
        "  fmt.Println(string(data))",
        "}",
      );
    } else if (lang === "ruby") {
      label = "Ruby";
      lines.push(
        "require 'net/http'",
        ...(originVariable ? [sampleOrigin(lang)] : []),
        "uri = URI(" + sampleUrl(request.url, lang, originVariable) + ")",
        "request = Net::HTTPGenericRequest.new(" +
          q(request.method) +
          ", true, true, uri.request_uri, {})",
        ...headers.map(([k, v]) => "request[" + q(k) + "] = " + q(v)),
        "request.set_form([" +
          parts
            .map(
              ([k, v]) =>
                "[" +
                q(k) +
                ", " +
                (v instanceof Blob
                  ? "File.open(" + q(nameOf(v)) + ", 'rb')"
                  : q(v)) +
                "]",
            )
            .join(", ") +
          "], 'multipart/form-data')",
        "response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https') { |http| http.request(request) }",
        "puts response.body",
      );
    } else if (lang === "php") {
      label = "PHP";
      // CURLFile cannot preserve repeated names in PHP's associative array: use cURL's MIME-style wire body instead.
      return [multipartWireSample(request, lang, label, originVariable)];
    } else if (lang === "java") {
      label = "Java";
      return [multipartWireSample(request, lang, label, originVariable)];
    } else if (lang === "rust") {
      label = "Rust";
      lines.push(
        "#[tokio::main]",
        "async fn main() -> Result<(), Box<dyn std::error::Error>> {",
        ...(originVariable ? ["  " + sampleOrigin(lang)] : []),
        "  let form = reqwest::multipart::Form::new()",
      );
      for (const [k, v] of parts)
        lines.push(
          "    ." +
            (v instanceof Blob
              ? "file(" + q(k) + ", " + q(nameOf(v)) + ").await?"
              : "text(" + q(k) + ", " + q(v) + ")"),
        );
      lines.push(
        "    ;",
        '  let response = reqwest::Client::new().request(reqwest::Method::from_bytes(b"' +
          request.method +
          '")?, ' +
          sampleUrl(request.url, lang, originVariable) +
          ")",
      );
      for (const [k, v] of headers) lines.push("    .header(" + q(k) + ", " + q(v) + ")");
      lines.push(
        "    .multipart(form).send().await?;",
        '  println!("{}", response.text().await?);',
        "  Ok(())",
        "}",
      );
    } else if (lang === "csharp") {
      label = "C#";
      lines.push(
        "using var client = new HttpClient();",
        ...(originVariable ? [sampleOrigin(lang)] : []),
        "using var content = new MultipartFormDataContent();",
      );
      for (const [k, v] of parts)
        lines.push(
          "content.Add(" +
            (v instanceof Blob
              ? "new StreamContent(File.OpenRead(" + q(nameOf(v)) + "))"
              : "new StringContent(" + q(v) + ")") +
            ", " +
            q(k) +
            (v instanceof Blob ? ", " + q(nameOf(v)) : "") +
            ");",
        );
      lines.push(
        "using var request = new HttpRequestMessage(new HttpMethod(" +
          q(request.method) +
          "), " +
          sampleUrl(request.url, lang, originVariable) +
          ") { Content = content };",
        ...headers.map(
          ([k, v]) => "request.Headers.TryAddWithoutValidation(" + q(k) + ", " + q(v) + ");",
        ),
        "using var response = await client.SendAsync(request);",
        "Console.WriteLine(await response.Content.ReadAsStringAsync());",
      );
    } else return [];
    return [{ lang, label, source: lines.join("\n") }];
  });
}

/** Standard-library multipart construction for clients without a native multipart builder. */
function multipartWireSample(
  request: RequestDescription,
  lang: "java" | "php",
  label: string,
  originVariable: boolean,
): CodeSample {
  const parts = request.body?.kind === "multipart" ? request.body.parts : [];
  const clean = (s: string) => s.replace(/"/g, "%22").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const php = lang === "php";
  const q = (value: string) => codeString(value, lang);
  const lines = php
    ? ["<?php", ...(originVariable ? [sampleOrigin(lang)] : []), '$boundary = "sourcey-" . bin2hex(random_bytes(16));', '$body = "";']
    : [
        "import java.net.http.*;",
        "import java.net.URI;",
        "import java.io.*;",
        "import java.nio.file.*;",
        "import java.nio.charset.StandardCharsets;",
        ...(originVariable ? [sampleOrigin(lang)] : []),
        'String boundary = "sourcey-" + java.util.UUID.randomUUID();',
        "var body = new ByteArrayOutputStream();",
      ];
  for (const [k, v] of parts) {
    const disposition =
      '\r\nContent-Disposition: form-data; name="' +
      clean(k) +
      '"' +
      (v instanceof Blob ? '; filename="' + clean(nameOf(v)) + '"' : "") +
      "\r\n\r\n";
    if (php)
      lines.push(
        '$body .= "--" . $boundary . ' +
          q(disposition) +
          " . " +
          (v instanceof Blob ? "file_get_contents(" + q(nameOf(v)) + ")" : q(v)) +
          ' . "\\r\\n";',
      );
    else
      lines.push(
        'body.write(("--" + boundary + ' + q(disposition) + ").getBytes(StandardCharsets.UTF_8));",
        "body.write(" +
          (v instanceof Blob
            ? "Files.readAllBytes(Path.of(" + q(nameOf(v)) + "))"
            : q(v) + ".getBytes(StandardCharsets.UTF_8)") +
          ");",
        'body.write("\\r\\n".getBytes(StandardCharsets.UTF_8));',
      );
  }
  if (php)
    lines.push(
      '$body .= "--" . $boundary . "--\\r\\n";',
      "$ch = curl_init(" + sampleUrl(request.url, lang, originVariable) + ");",
      "curl_setopt($ch, CURLOPT_CUSTOMREQUEST, " + q(request.method) + ");",
      "curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);",
      'curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: multipart/form-data; boundary=" . $boundary, ' +
        request.headers
          .filter(([k]) => k.toLowerCase() !== "content-type")
          .map(([k, v]) => q(k + ": " + v))
          .join(", ") +
        "]);",
      "curl_setopt($ch, CURLOPT_POSTFIELDS, $body);",
      "echo curl_exec($ch);",
      "curl_close($ch);",
    );
  else
    lines.push(
      'body.write(("--" + boundary + "--\\r\\n").getBytes(StandardCharsets.UTF_8));',
      "var request = HttpRequest.newBuilder(URI.create(" + sampleUrl(request.url, lang, originVariable) + "))",
      '  .header("Content-Type", "multipart/form-data; boundary=" + boundary)',
      ...request.headers
        .filter(([k]) => k.toLowerCase() !== "content-type")
        .map(([k, v]) => "  .header(" + q(k) + ", " + q(v) + ")"),
      "  .method(" +
        q(request.method) +
        ", HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build();",
      "var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());",
      "System.out.println(response.body());",
    );
  return { lang, label, source: lines.join("\n") };
}

