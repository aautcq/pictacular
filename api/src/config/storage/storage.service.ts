import { Injectable } from '@nestjs/common';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { JwtService } from '@/config/jwt/jwt.service';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  GetBucketLocationCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type BucketLocationConstraint
} from '@aws-sdk/client-s3';

@Injectable()
export class StorageService {
  client: S3Client | null;
  bucket: string | null;
  region: BucketLocationConstraint | null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {
    this.client = null;
    this.bucket = null;
    this.region = null;
  }

  init(awsCredentials: { region?: string; tokens: string }) {
    const { access_key_id, secret_access_key } =
      this.jwtService.decodeAwsCredentials(awsCredentials.tokens);

    this.region =
      (awsCredentials.region as BucketLocationConstraint) ?? 'eu-west-3';

    this.client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: access_key_id,
        secretAccessKey: secret_access_key
      }
    });
  }

  initWithBucket(awsCredentials: {
    region: string;
    bucket: string;
    tokens: string;
  }) {
    this.bucket = awsCredentials.bucket;
    this.init(awsCredentials);
  }

  get is_initialized() {
    return !!this.bucket && !!this.client;
  }

  private static getFormatFromMimeType(mime_type: string) {
    if (mime_type.includes('pdf')) {
      return { extension: 'pdf', content_type: 'application/pdf' };
    } else if (mime_type.includes('jpeg') || mime_type.includes('jpg')) {
      return { extension: 'jpg', content_type: 'image/jpeg' };
    } else if (mime_type.includes('png')) {
      return { extension: 'png', content_type: 'image/png' };
    } else if (mime_type.includes('msword')) {
      return { extension: 'doc', content_type: 'application/msword' };
    } else if (mime_type.includes('vnd.openxmlformats-officedocument')) {
      return {
        extension: 'docx',
        content_type:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };
    } else if (mime_type.includes('json')) {
      return { extension: 'json', content_type: 'application/json' };
    } else if (mime_type.includes('csv')) {
      return { extension: 'csv', content_type: 'text/csv' };
    } else if (mime_type.includes('application/rss+xml')) {
      return { extension: 'xml', content_type: 'application/xml' };
    } else {
      return { extension: mime_type, content_type: mime_type };
    }
  }

  private get corsRule() {
    return {
      ID: 'CORSRule',
      AllowedHeaders: ['*'],
      AllowedMethods: ['GET'],
      AllowedOrigins: [this.configService.get<string>('clientUri')],
      ExposeHeaders: [],
      MaxAgeSeconds: 3000
    };
  }

  getNewKey(filename: string, mime_type: string, suffix = '') {
    if (!filename) throw new Error('Filename is required');

    const file_format = StorageService.getFormatFromMimeType(mime_type);

    if (filename.includes('.')) {
      const filenameSplit = filename.split('.');
      filenameSplit.pop();
      return `${filenameSplit.join('.')}${suffix}.${file_format.extension}`;
    }
    return `${filename}${suffix}.${file_format.extension}`;
  }

  async getRegion() {
    if (!this.client || !this.bucket) {
      throw new Error('Storage service is not initialized');
    }

    const getBucketLocationCommand = new GetBucketLocationCommand({
      Bucket: this.bucket
    });

    const location = await this.client.send(getBucketLocationCommand);
    this.region = location.LocationConstraint ?? 'eu-west-3';
    return this.region;
  }

  async createBucket() {
    if (!this.client) {
      throw new Error('Storage service is not initialized');
    }

    const prefix = process.env.NODE_ENV !== 'production' ? 'dev-' : '';
    this.bucket = `pictacular-${prefix}${uuidv4()}`;

    try {
      const createBucketCommand = new CreateBucketCommand({
        ACL: 'private',
        Bucket: this.bucket,
        CreateBucketConfiguration: {
          LocationConstraint: this.region ?? undefined
        }
      });

      const putBucketCorsCommand = new PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: {
          CORSRules: [this.corsRule]
        }
      });

      await this.client.send(createBucketCommand);
      await this.client.send(putBucketCorsCommand);

      return this.bucket;
    } catch (e) {
      console.log(`error: ${e}`);
      return '';
    }
  }

  async getBucket(bucket: string) {
    if (!this.client) {
      throw new Error('Storage service is not initialized');
    }

    try {
      const headBucketCommand = new HeadBucketCommand({
        Bucket: bucket
      });
      await this.client.send(headBucketCommand);
      this.bucket = bucket;
      return this.bucket;
    } catch (e) {
      console.log(`error: ${e}`);
      return '';
    }
  }

  async setupBucket() {
    if (!this.client || !this.bucket) {
      throw new Error('Storage service is not initialized');
    }

    try {
      let CORSRules;
      try {
        // get bucket CORS
        const getBucketCorsCommand = new GetBucketCorsCommand({
          Bucket: this.bucket
        });
        const CORS = await this.client.send(getBucketCorsCommand);
        CORSRules = CORS.CORSRules;
      } catch (e) {
        // bucket CORS does not exist
      }

      // add our CORS rule
      const putBucketCorsCommand = new PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: {
          CORSRules: [...(CORSRules ?? []), this.corsRule]
        }
      });
      await this.client.send(putBucketCorsCommand);
      return true;
    } catch (e) {
      console.log(`error: ${e}`);
      return false;
    }
  }

  async storeData(key: string, data: string, mime_type: string) {
    if (!key || !data) throw new Error('Key and data and are required');
    if (!this.bucket || !this.client) {
      throw new Error('Storage service is not initialized');
    }

    // :acl key accepts public-read, public-read-write, private (cf doc for full rights)
    try {
      const file_format = StorageService.getFormatFromMimeType(mime_type);

      const command = new PutObjectCommand({
        ACL: 'private',
        Bucket: this.bucket,
        Key: key,
        Body: Buffer.from(data, 'base64'),
        ContentEncoding: 'base64',
        ContentType: file_format.content_type
      });

      await this.client.send(command);

      return true;
    } catch (e) {
      console.log(`error: ${e}`);
      return false;
    }
  }

  async listData(next_token?: string) {
    if (!this.bucket || !this.client) {
      throw new Error('Storage service is not initialized');
    }

    let files: {
      key: string;
      last_modified: Date;
      size: number;
      mime_type: string;
    }[] = [];

    const listObjectsCommand = new ListObjectsV2Command({
      Bucket: this.bucket,
      MaxKeys: 100,
      ContinuationToken: next_token
    });

    const { Contents, IsTruncated, NextContinuationToken } =
      await this.client.send(listObjectsCommand);

    if (Contents) {
      files = await Promise.all(
        Contents.map(async ({ Key, LastModified, Size }) => {
          const headObjectCommand = new HeadObjectCommand({
            Bucket: this.bucket ?? undefined,
            Key
          });

          const res = await this.client?.send(headObjectCommand);

          return {
            key: Key ?? '',
            last_modified: LastModified ?? new Date(),
            size: Size ?? 0,
            mime_type: res?.ContentType ?? ''
          };
        })
      );
    }

    return {
      is_truncated: IsTruncated ?? false,
      next_token: NextContinuationToken,
      photos: files.filter(({ mime_type }) => mime_type.includes('image'))
    };
  }

  async generateSecureUrl(key: string, expiration = 3600) {
    if (!this.bucket || !this.client)
      throw new Error('Storage service is not initialized');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    return await getSignedUrl(this.client, command, { expiresIn: expiration });
  }

  async destroyData(key: string) {
    if (!this.bucket || !this.client) {
      throw new Error('Storage service is not initialized');
    }

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      await this.client.send(command);
      return true;
    } catch (e) {
      console.log(`error: ${e}`);
      return false;
    }
  }
}
