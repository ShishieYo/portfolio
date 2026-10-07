/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, details);
export const unauthorized = (m = "Sign in required") => new HttpError(401, m);
export const forbidden = (m = "You do not have permission to do that") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);
export const conflict = (m: string, details?: unknown) => new HttpError(409, m, details);
export const unprocessable = (m: string, details?: unknown) => new HttpError(422, m, details);
