/**
 * JSON embedded in a script element must not contain a literal `<`, otherwise
 * manager-authored content such as `</script>` can terminate the JSON-LD tag.
 */
export function safeJsonLdStringify(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
