export class PushSubscription {
  id: string;
  created_at: Date;
  updated_at: Date;

  endpoint: string;
  keys: string;

  user_id: string;
  user: unknown;
}

export type PushSubscriptionCreate = Pick<
  PushSubscription,
  'endpoint' | 'keys'
>;
