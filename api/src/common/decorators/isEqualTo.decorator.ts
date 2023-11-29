import { registerDecorator, type ValidationOptions } from 'class-validator';
import { IsEqualTo as IsEqualToValidator } from '@/common/validators/isEqualTo.validator';

export const IsEqualTo = (
  property: string,
  validationOptions?: ValidationOptions
) => {
  return (object: unknown, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [property],
      validator: IsEqualToValidator
    });
  };
};
