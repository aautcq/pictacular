import { IsNotEmpty, IsString, IsObject } from 'class-validator';

export class VerifyBiometricsDto {
  @IsNotEmpty()
  @IsString()
  challenge: string;

  @IsNotEmpty()
  @IsString()
  credential_id: string;

  @IsNotEmpty()
  @IsObject()
  data: {
    id: string;
    rawId: string;
    response: {
      authenticatorData: string;
      clientDataJSON: string;
      signature: string;
      userHandle?: string;
    };
  };
}
