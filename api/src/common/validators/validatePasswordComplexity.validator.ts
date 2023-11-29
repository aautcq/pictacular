import {
  type ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface
} from 'class-validator';

@ValidatorConstraint({ async: false })
export class ValidatePasswordComplexity
  implements ValidatorConstraintInterface
{
  validate(password: string, args: ValidationArguments): boolean {
    if (!password) return true;
    const passwordComplexity = args.constraints[0] || 3;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasSpecialCharacters = /\W/.test(password);
    const hasNumbers = /\d/.test(password);
    const passwordValidation = [
      hasUpperCase,
      hasLowerCase,
      hasSpecialCharacters,
      hasNumbers
    ];
    return passwordValidation.filter(Boolean).length >= passwordComplexity;
  }

  defaultMessage(args: ValidationArguments): string {
    const password = args.property;
    const complexity = args.constraints[0] || 3;
    return `${password} complexity is not sufficient (min ${complexity} / 4)`;
  }
}
