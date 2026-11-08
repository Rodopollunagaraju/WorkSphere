const { Forbidden } = require('@worksphere/errors');
const ROLES = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'];
const rank = (r) => ROLES.indexOf(r);
const atLeast = (role, min) => rank(role) >= 0 && rank(role) >= rank(min);

// Identity comes ONLY from headers injected by the gateway (services are not exposed publicly).
function requireUser(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) return next(Forbidden('Missing identity'));
  req.user = { id: userId, orgId: req.headers['x-org-id'] || null, role: req.headers['x-role'] || null, plan: req.headers['x-plan'] || null };
  next();
}
const requireOrgRole = (min) => (req, res, next) =>
  requireUser(req, res, (err) => {
    if (err) return next(err);
    if (!req.user.orgId) return next(Forbidden('Select an organization first'));
    if (!atLeast(req.user.role, min)) return next(Forbidden(`Requires ${min} role`));
    next();
  });

// Service-to-service calls (never routed through the gateway).
const requireInternal = (token) => (req, res, next) =>
  (token && req.headers['x-internal-token'] === token ? next() : next(Forbidden('Internal only')));

module.exports = { ROLES, rank, atLeast, requireUser, requireOrgRole, requireInternal };
