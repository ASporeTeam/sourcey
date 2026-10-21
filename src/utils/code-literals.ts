/** String values are encoded for the language receiving them, including control bytes. */
export function codeString(value: string, language: string): string {
  if (language === "curl") return "'" + value.replace(/'/g, "'\\''") + "'";
  const single = ["javascript", "typescript", "python"].includes(language) || ["ruby", "php"].includes(language) && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  const quote = single ? "'" : '"';
  let result = quote;
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (char === "\\" || char === quote) result += "\\" + char;
    else if (!single && language === "ruby" && char === "#" || !single && language === "php" && char === "$") result += "\\" + char;
    else if (point < 32 || point === 127) {
      const short = ({ 9: "\\t", 10: "\\n", 13: "\\r" } as Record<number, string>)[point];
      result += short ?? (language === "rust" ? `\\u{${point.toString(16)}}` : language === "java" ? `\\${point.toString(8).padStart(3, "0")}` : language === "csharp" ? `\\u${point.toString(16).padStart(4, "0")}` : `\\x${point.toString(16).padStart(2, "0")}`);
    } else result += char;
  }
  return result + quote;
}

/**
 * Text over several lines, such as a pretty-printed JSON body, as the
 * language's raw or multi-line string, so it reads as it is sent: its lines
 * start at the margin and keep their bytes. Undefined where that form cannot
 * carry the text exactly; the caller then writes it as one escaped string.
 */
export function codeBlockString(value: string, language: string): string | undefined {
  const control = Array.from(value).some((char) => {
    const point = char.charCodeAt(0);
    return point < 32 && point !== 10 || point === 127;
  });
  if (!value.includes("\n") || control) return undefined;
  const lines = value.split("\n");
  switch (language) {
    case "curl":
      return codeString(value, language);
    case "javascript":
    case "typescript":
      return "`" + value.replace(/[\\`]|\$\{/g, (match) => "\\" + match) + "`";
    case "python":
      return "'''" + value.replace(/[\\']/g, (match) => "\\" + match) + "'''";
    case "go":
      return value.includes("`") ? undefined : "`" + value + "`";
    case "rust": {
      let hashes = "#";
      while (value.includes('"' + hashes)) hashes += "#";
      return "r" + hashes + '"' + value + '"' + hashes;
    }
    case "java": {
      // A text block strips each line's trailing blanks and the lines' common indent.
      if (lines.some((line) => / $/.test(line)) || lines.every((line) => !line || line.startsWith(" "))) return undefined;
      const escaped = value.replace(/\\/g, "\\\\").replace(/"{3,}/g, (run) => run.replace(/"/g, '\\"')).replace(/"{1,2}$/, (run) => run.replace(/"/g, '\\"'));
      return '"""\n' + escaped + '"""';
    }
    case "php":
      return lines.some((line) => /^\s*BODY\b/.test(line)) ? undefined : "<<<'BODY'\n" + value + "\nBODY";
    case "ruby":
      return lines.some((line) => /^\s*BODY$/.test(line)) ? undefined : "<<-'BODY'.chomp\n" + value + "\nBODY";
    case "csharp": {
      const quotes = '"'.repeat(Math.max(3, ...(value.match(/"+/g) ?? []).map((run) => run.length + 1)));
      return quotes + "\n" + value + "\n" + quotes;
    }
  }
  return undefined;
}

const originNames: Record<string, string> = { curl: "BASE_URL", javascript: "baseUrl", typescript: "baseUrl", python: "base_url", go: "baseURL", ruby: "base_url", java: "baseUrl", php: "$baseUrl", rust: "base_url", csharp: "baseUrl" };
export function sampleUrl(url: string, language: string, originVariable = false): string {
  const literal = codeString(url, language);
  if (!originVariable) return literal;
  const variable = originNames[language];
  if (!variable) throw new Error(`Unsupported sample language: ${language}`);
  return language === "curl" ? `"\${${variable}}"${literal}` : language === "php" ? `${variable} . ${literal}` : language === "rust" ? `${variable}.to_owned() + ${literal}` : `${variable} + ${literal}`;
}
export function sampleOrigin(language: string): string {
  const variable = originNames[language];
  const value = codeString("YOUR_API_ORIGIN", language);
  if (language === "go") return `const ${variable} = ${value}`;
  if (language === "java") return `String ${variable} = ${value};`;
  if (language === "rust") return `let ${variable} = ${value};`;
  if (language === "csharp") return `var ${variable} = ${value};`;
  if (language === "javascript" || language === "typescript") return `const ${variable} = ${value};`;
  return `${variable}=${value}${language === "php" ? ";" : ""}`;
}
