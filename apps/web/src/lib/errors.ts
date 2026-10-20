/** Error from the database or API, with the code the server sent when there is one. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** SQLSTATEs raised by our database functions (see supabase/migrations). */
export const DB_CODES = {
  conflict: 'PF409',
  invalid: 'PF422',
  locked: 'PF423',
  forbidden: '42501',
  notFound: 'P0002',
} as const;

interface PostgrestLikeError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export function fromPostgrest(error: PostgrestLikeError): AppError {
  if (error.code === '42501' && /permission denied|row-level security/i.test(error.message)) {
    return new AppError('You do not have permission to do that in this project.', error.code);
  }
  if (error.code === '23505') return new AppError('That name is already in use.', error.code);
  if (error.code === '23514') return new AppError('Some values are not in the expected format.', error.code);
  return new AppError(error.message, error.code ?? null);
}

export function isConflict(error: unknown): boolean {
  return error instanceof AppError && error.code === DB_CODES.conflict;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
