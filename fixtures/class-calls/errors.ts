export class HttpException extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export class NotFound extends HttpException {}
export class Plain {}
