// 404 for any route that did not match.
export function notFound(req, res, next) {
  const err = new Error(`Not found - ${req.originalUrl}`)
  err.status = 404
  next(err)
}

// Centralised error handler. Must have four arguments or Express will not
// recognise it as an error handler. Register it last, after all routes.
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500
  let message = err.message || 'Server error'

  // Turn common Sequelize failures into clean 400s instead of 500s.
  if (err.name === 'SequelizeValidationError') {
    status = 400
    message = err.errors.map(e => e.message).join(', ')
  }
  if (err.name === 'SequelizeUniqueConstraintError') {
    status = 409
    message = 'That value is already taken'
  }
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    status = 400
    message = 'Related record does not exist'
  }

  if (status >= 500) console.error(err)

  res.status(status).json({
    message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  })
}

// Wraps an async controller so a rejected promise reaches errorHandler
// instead of hanging the request. Saves a try/catch in every controller.
export const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)

export default errorHandler
