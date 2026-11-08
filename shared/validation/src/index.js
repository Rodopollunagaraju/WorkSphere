const { BadRequest } = require('@worksphere/errors');

// validate(schema, 'body' | 'query' | 'params')
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return next(BadRequest('Validation failed', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
  }
  req[source] = result.data;
  next();
};
module.exports = { validate };
