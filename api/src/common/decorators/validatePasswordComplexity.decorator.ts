import { registerDecorator, type ValidationOptions } from 'class-validator';
import { ValidatePasswordComplexity as ValidatePasswordComplexityValidator } from '@/common/validators/validatePasswordComplexity.validator';

export function ValidatePasswordComplexity(
  complexity: number,
  validationOptions?: ValidationOptions
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [complexity],
      validator: ValidatePasswordComplexityValidator
    });
  };
}
