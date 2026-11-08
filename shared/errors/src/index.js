class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const BadRequest = (m = 'Bad request', d) => new AppError(400, 'BAD_REQUEST', m, d);
const Unauthorized = (m = 'Unauthorized') => new AppError(401, 'UNAUTHORIZED', m);
const Forbidden = (m = 'Forbidden') => new AppError(403, 'FORBIDDEN', m);
const NotFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
const Conflict = (m = 'Conflict', d) => new AppError(409, 'CONFLICT', m, d);

// Central Express error handler: consistent JSON shape, no stack leaks.
function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err && err.code === 11000) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Duplicate value' } });
    }
    (logger || console).error({ err }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  };
}

// Wrap async route handlers so rejections reach the error handler.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, BadRequest, Unauthorized, Forbidden, NotFound, Conflict, errorHandler, asyncHandler };
