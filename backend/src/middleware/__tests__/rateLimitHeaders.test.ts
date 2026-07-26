import { Request, Response, NextFunction } from 'express';
import { rateLimitHeaders } from '../rateLimitHeaders.js';

describe('rateLimitHeaders middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response> & {
    headersSent: boolean;
    statusCode: number;
    _headers: Record<string, unknown>;
  };
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = { path: '/api/employees' };

    const headers: Record<string, unknown> = {};
    mockResponse = {
      headersSent: false,
      statusCode: 200,
      _headers: headers,
      setHeader: jest.fn((name: string, value: unknown) => {
        headers[name] = value;
        return mockResponse as unknown as Response;
      }) as unknown as Response['setHeader'],
      getHeader: jest.fn((name: string) => headers[name]) as unknown as Response['getHeader'],
      json: jest.fn(function (this: Response, body: unknown) {
        return this;
      }) as unknown as Response['json'],
      send: jest.fn(function (this: Response, body: unknown) {
        return this;
      }) as unknown as Response['send'],
    };

    nextFunction = jest.fn();
  });

  it('applies default headers when no upstream limiter ran', () => {
    const middleware = rateLimitHeaders();
    middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();

    (mockResponse.json as unknown as (body: unknown) => void)({ ok: true });

    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 1000);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 1000);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
  });

  it('prefers smart rate limiter headers when present', () => {
    mockResponse._headers['X-Smart-RateLimit-Limit'] = 100;
    mockResponse._headers['X-Smart-RateLimit-Remaining'] = 42;
    mockResponse._headers['X-Smart-RateLimit-Reset'] = 1700000000;

    const middleware = rateLimitHeaders();
    middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    (mockResponse.json as unknown as (body: unknown) => void)({ ok: true });

    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 42);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', 1700000000);
  });

  it('falls back to organization rate limiter minute-window headers', () => {
    mockResponse._headers['X-RateLimit-Limit-Minute'] = 60;
    mockResponse._headers['X-RateLimit-Remaining-Minute'] = 5;
    mockResponse._headers['X-RateLimit-Reset-Minute'] = new Date(1700000000 * 1000).toISOString();

    const middleware = rateLimitHeaders();
    middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    (mockResponse.json as unknown as (body: unknown) => void)({ ok: true });

    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 60);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 5);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', 1700000000);
  });

  it('applies a route override limit', () => {
    mockRequest.path = '/api/auth/login';

    const middleware = rateLimitHeaders({ routeOverrides: { '/api/auth': { limit: 20 } } });
    middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    (mockResponse.json as unknown as (body: unknown) => void)({ ok: true });

    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 20);
  });

  it('adds Retry-After on 429 responses when not already set', () => {
    mockResponse.statusCode = 429;

    const middleware = rateLimitHeaders();
    middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    (mockResponse.json as unknown as (body: unknown) => void)({ error: 'Too Many Requests' });

    expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('does not overwrite an existing Retry-After header', () => {
    mockResponse.statusCode = 429;
    mockResponse._headers['Retry-After'] = 15;

    const middleware = rateLimitHeaders();
    middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    (mockResponse.json as unknown as (body: unknown) => void)({ error: 'Too Many Requests' });

    expect(mockResponse.setHeader).not.toHaveBeenCalledWith('Retry-After', expect.anything());
  });

  it('skips header application if headers were already sent', () => {
    mockResponse.headersSent = true;

    const middleware = rateLimitHeaders();
    middleware(mockRequest as Request, mockResponse as Response, nextFunction);
    (mockResponse.send as unknown as (body: unknown) => void)('ok');

    expect(mockResponse.setHeader).not.toHaveBeenCalled();
  });
});
