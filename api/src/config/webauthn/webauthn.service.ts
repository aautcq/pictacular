import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Fido2Lib } from 'fido2-lib';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { coerceToArrayBuffer, coerceToBase64Url } from 'fido2-lib';
import type { UserBiometrics } from '@/users/entities/user.entity';

@Injectable()
export class WebauthnService {
  f2l: Fido2Lib;

  constructor(private readonly configService: ConfigService) {
    this.f2l = new Fido2Lib({
      timeout: 42,
      rpId: this.configService.get<string>('CLIENT_HOST'),
      rpName: 'Pictacular',
      rpIcon:
        'https://pictacular.s3.eu-west-3.amazonaws.com/android-chrome-192x192.png',
      challengeSize: 128,
      // attestation: 'none',
      cryptoParams: [-7]
      // authenticatorAttachment: 'platform',
      // authenticatorRequireResidentKey: false,
      // authenticatorUserVerification: 'required'
    });
  }

  private base64UrlEncode(inputString: string | number) {
    const base64 = btoa(`${inputString}`);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async getRegistrationOptions(user: UserBiometrics) {
    const registrationOptions = await this.f2l.attestationOptions();

    registrationOptions.user.id = user.id as unknown as ArrayBuffer;
    registrationOptions.user.name = user.email;
    registrationOptions.user.displayName = user.email;

    registrationOptions.challenge = coerceToBase64Url(
      registrationOptions.challenge,
      'challenge'
    );

    return registrationOptions;
  }

  async getAssertionOptions() {
    const assertionOptionsOptions = await this.f2l.assertionOptions();

    assertionOptionsOptions.challenge = coerceToBase64Url(
      assertionOptionsOptions.challenge,
      'challenge'
    );

    return assertionOptionsOptions;
  }

  async registerResult(
    data: {
      id?: string;
      rawId?: string;
      response: {
        attestationObject: string;
        clientDataJSON: string;
      };
    },
    challenge: string
  ) {
    const clientAttestationResponse = {
      id: coerceToArrayBuffer(data.id, 'id'),
      rawId: coerceToArrayBuffer(data.rawId, 'rawId'),
      response: {
        attestationObject: data.response.attestationObject,
        clientDataJSON: data.response.clientDataJSON
      }
    };

    const attestationExpectations = {
      challenge,
      origin: this.configService.get<string>('CLIENT_URL'),
      factor: 'first'
    } as const;

    try {
      const result = await this.f2l.attestationResult(
        clientAttestationResponse,
        attestationExpectations
      );

      const credentialId = coerceToBase64Url(
        result.authnrData.get('credId'),
        'credentialId'
      );
      const pem = result.authnrData.get('credentialPublicKeyPem');
      const counter = result.authnrData.get('counter');
      return { credentialId, pem, counter };
    } catch (error) {
      console.log(error);
      return;
    }
  }

  async assertResult(
    data: {
      id?: string;
      rawId?: string;
      response: {
        authenticatorData: string;
        clientDataJSON: string;
        signature: string;
        userHandle?: string;
      };
    },
    challenge: string,
    credentialId: string,
    pem: string,
    counter: number,
    user_id: number
  ) {
    const clientAssertionResponse = {
      id: coerceToArrayBuffer(data.id, 'id'),
      rawId: coerceToArrayBuffer(data.rawId, 'rawId'),
      response: {
        clientDataJSON: data.response.clientDataJSON,
        authenticatorData: coerceToArrayBuffer(
          data.response.authenticatorData,
          'authenticatorData'
        ),
        signature: data.response.signature,
        userHandle: data.response.userHandle
      }
    };

    const assertionExpectations = {
      allowCredentials: [
        {
          id: coerceToArrayBuffer(credentialId, 'id'),
          type: 'public-key' as const
        }
      ],
      challenge,
      origin: this.configService.get<string>('CLIENT_URL'),
      factor: 'first' as const,
      publicKey: pem,
      prevCounter: counter,
      userHandle: this.base64UrlEncode(user_id)
    };

    const result = await this.f2l.assertionResult(
      clientAssertionResponse,
      assertionExpectations
    );
    return result.authnrData.get('counter');
  }
}
