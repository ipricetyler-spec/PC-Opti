import { createContext, useContext } from 'react';
import type { ActionPreviewRequest } from './ActionPreviewDialog';

export interface ConfirmRequest {
  title: string;
  description: string;
  details: string;
  notice: string;
  confirmLabel: string;
  detailsLabel?: string;
  tone?: 'default' | 'danger';
}

type ConfirmFunction = (request: ConfirmRequest) => Promise<boolean>;

export function toPreviewRequest(request: ConfirmRequest): ActionPreviewRequest {
  return { ...request, detailsLabel: request.detailsLabel || 'What will happen' };
}

// Falls back to the browser dialog only when no provider is mounted (isolated tests).
const fallback: ConfirmFunction = async (request) => window.confirm(`${request.title}\n\n${request.description}\n\n${request.details}\n\n${request.notice}`);

export const ConfirmContext = createContext<ConfirmFunction>(fallback);

export function useConfirm() {
  return useContext(ConfirmContext);
}
