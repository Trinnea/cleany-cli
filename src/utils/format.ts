import path from 'node:path';
import type {DeletionMethod} from '../types.js';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), BYTE_UNITS.length - 1);
  const scaled = value / Math.pow(1024, unitIndex);
  return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${BYTE_UNITS[unitIndex]}`;
}

export function formatMethod(method: DeletionMethod): string {
  return method === 'trash' ? 'Trash' : 'Permanent';
}

export function compactPath(inputPath: string, maxLength = 58): string {
  if (inputPath.length <= maxLength) {
    return inputPath;
  }

  const basename = path.basename(inputPath);
  if (basename.length + 4 >= maxLength) {
    return `.../${basename.slice(-(maxLength - 4))}`;
  }

  return `.../${basename}`;
}

export function compactPathMiddle(inputPath: string, maxLength = 58): string {
  if (inputPath.length <= maxLength) {
    return inputPath;
  }

  if (maxLength <= 7) {
    return inputPath.slice(0, maxLength);
  }

  const left = Math.ceil((maxLength - 3) / 2);
  const right = Math.floor((maxLength - 3) / 2);
  return `${inputPath.slice(0, left)}...${inputPath.slice(-right)}`;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function renderBar(value: number, max: number, width = 20): string {
  if (max <= 0) {
    return '░'.repeat(width);
  }

  const fill = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return `${'█'.repeat(fill)}${'░'.repeat(width - fill)}`;
}
