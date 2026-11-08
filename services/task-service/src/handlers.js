const { deleteByPattern } = require('@worksphere/redis');
// Event-driven cache invalidation: when project membership/state changes, drop the cached lookups.
module.exports = function createHandlers({ redis }) {
  const invalidate = async (event) => {
    const org = event.organizationId; const { projectId } = event.payload;
    return async () => { await deleteByPattern(redis, `pm:${org}:${projectId}:*`); }; // runs after commit
  };
  return { PROJECT_UPDATED: invalidate, PROJECT_ARCHIVED: invalidate, PROJECT_MEMBER_ADDED: invalidate, PROJECT_MEMBER_REMOVED: invalidate };
};
