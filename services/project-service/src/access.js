const { atLeast } = require('@worksphere/rbac');
// ADMIN/OWNER see every project in the org; others only projects they belong to.
const sees = (user) => atLeast(user.role, 'ADMIN');
const visibleFilter = (user) => (sees(user) ? {} : { members: user.id });
const canSee = (user, project) => sees(user) || project.members.includes(user.id);
module.exports = { visibleFilter, canSee };
