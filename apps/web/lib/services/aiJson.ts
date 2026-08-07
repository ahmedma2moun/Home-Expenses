/** Models sometimes wrap JSON in prose or code fences despite instructions — grab the outermost
 *  object. Shared by extraction (§7.2) and comparison (§7.3) response parsing. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Response did not contain a JSON object.");
  }
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}
