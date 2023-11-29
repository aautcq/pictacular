import { AtLeast } from '@/common/types';

export class Session {
  id: string;
  created_at: Date;
  updated_at: Date;

  active: boolean;
  user_agent: string;
  refresh_token: string | null;

  user_id: string;
  user: unknown;
}

// Session unique fields
type SessionUniqueFields = Partial<Pick<Session, 'id'>>;

// Session CRUD
export type SessionCreate = Pick<Session, 'active' | 'user_agent' | 'user_id'>;
export type SessionFindUnique = AtLeast<SessionUniqueFields, 'id'> &
  Partial<Pick<Session, 'refresh_token'>>;
export type SessionUpdate = Pick<Session, 'id'> &
  Partial<Pick<Session, 'active' | 'refresh_token'>>;
export type SessionRevokeAllExceptOne = Pick<Session, 'id' | 'user_id'>;
