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
