import type { ExistenceStatus, ReviewStatus } from '../sync/sync.js';

export interface CardRecord {
  id: number;
  title: string;
  keyPoint: string;
  existence: ExistenceStatus;
  review: ReviewStatus;
  file: string | null;
}
