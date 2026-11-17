import type {FieldValues, Path, UseFormSetError} from 'react-hook-form';
import {ApiError} from '@/api/client';

/**
 * Puts the API's per-field messages on the form and returns the message to show
 * above the form, or null when every problem was shown on a field.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: Path<T>[],
): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  let placed = false;
  for (const [field, message] of Object.entries(error.fields)) {
    if ((knownFields as string[]).includes(field)) {
      setError(field as Path<T>, {message});
      placed = true;
    }
  }
  return placed ? null : error.message;
}
