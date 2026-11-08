// Tiny route-table -> OpenAPI 3 generator so every service documents itself without annotations.
function buildSpec({ title, prefix = '', routes }) {
  const paths = {};
  for (const r of routes) {
    const p = (prefix + r.path).replace(/:([A-Za-z]+)/g, '{$1}');
    const params = [...(r.path.matchAll(/:([A-Za-z]+)/g))].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    (paths[p] = paths[p] || {})[r.method.toLowerCase()] = {
      summary: r.summary, tags: [r.tag || title],
      description: r.role ? `Requires role: ${r.role}+` : undefined,
      security: r.public ? [] : [{ bearerAuth: [] }],
      parameters: params,
      requestBody: r.body ? { required: true, content: { 'application/json': { schema: { type: 'object', properties: Object.fromEntries(Object.entries(r.body).map(([k, t]) => [k, { type: t.replace('?', '') }])), required: Object.entries(r.body).filter(([, t]) => !t.endsWith('?')).map(([k]) => k) } } } } : undefined,
      responses: { 200: { description: 'OK' }, 400: { description: 'Validation error' }, 401: { description: 'Unauthorized' }, 403: { description: 'Forbidden' }, ...(r.method === 'POST' ? { 201: { description: 'Created' } } : {}) },
    };
  }
  return { openapi: '3.0.3', info: { title: `WorkSphere ${title}`, version: '1.0.0' }, paths, components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } } };
}
function mountDocs(app, opts) {
  const swaggerUi = require('swagger-ui-express');
  const spec = buildSpec(opts);
  app.get('/openapi.json', (req, res) => res.json(spec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
}
module.exports = { buildSpec, mountDocs };
