export class PushSubscription {
  id: number;
  created_at: Date;
  updated_at: Date;

  endpoint: string;
  keys: string;

  user_id: number;
  user: unknown;
}

export type PushSubscriptionCreate = Pick<
  PushSubscription,
  'endpoint' | 'keys'
>;
