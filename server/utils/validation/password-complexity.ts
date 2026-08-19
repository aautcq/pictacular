// Password-complexity rule ported from the former
// ValidatePasswordComplexity class-validator constraint: at least
// `minComplexity` of the 4 character classes (upper/lower case, digit,
// special character) must be present. Shared by any schema that accepts a
// new password (register, set-password).
export function hasSufficientPasswordComplexity(password: string, minComplexity = 3) {
  const rules = [/[A-Z]/, /[a-z]/, /\d/, /\W/]
  const satisfiedRules = rules.filter(rule => rule.test(password)).length

  return satisfiedRules >= minComplexity
}
