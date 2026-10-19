/** One password rule for the whole app (invite, change, reset): 10-72 chars and at least 3 of 4 character classes. */
export function passwordIssue(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 72) return "Use at most 72 characters.";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  return classes < 3 ? "Mix at least three of: lowercase, uppercase, digits, symbols." : null;
}
