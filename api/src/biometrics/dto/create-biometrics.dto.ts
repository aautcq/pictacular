import { IsNotEmpty, IsString, IsObject } from 'class-validator';

export class CreateBiometricsDto {
  @IsNotEmpty()
  @IsString()
  challenge: string;

  @IsNotEmpty()
  @IsObject()
  data: {
    id: string;
    rawId: string;
    response: {
      attestationObject: string;
      clientDataJSON: string;
    };
  };
}
