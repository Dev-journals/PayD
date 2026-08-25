import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

const REQUEST_ID_HEADER = 'x-request-id';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers[REQUEST_ID_HEADER];
  const requestId = (Array.isArray(incomingId) ? incomingId[0] : incomingId) || uuidv4();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
}
