import type { ExistenceStatus, ReviewStatus } from '../sync/sync.js';

export const EXISTENCE_LABEL: Record<ExistenceStatus, string> = {
  present: '存在',
  partial: '已被修改',
  gone: '已消失',
  discarded: '已捨棄',
  superseded: '已被取代',
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  unreviewed: '未 review',
  confirmed: '已確認',
  changed_after_confirm: '確認後又改過',
  incorrect: '說明不正確',
  unimportant: '不重要',
};

export const EXISTENCE_LABEL_EN: Record<ExistenceStatus, string> = {
  present: 'present',
  partial: 'modified',
  gone: 'gone',
  discarded: 'discarded',
  superseded: 'superseded',
};

export const REVIEW_LABEL_EN: Record<ReviewStatus, string> = {
  unreviewed: 'unreviewed',
  confirmed: 'confirmed',
  changed_after_confirm: 'changed after confirm',
  incorrect: 'incorrect',
  unimportant: 'not important',
};
