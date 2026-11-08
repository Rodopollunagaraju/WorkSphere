// TODO -> IN_PROGRESS -> IN_REVIEW -> DONE, one step back allowed, DONE can be reopened.
const TRANSITIONS = {
  TODO: ['IN_PROGRESS'],
  IN_PROGRESS: ['TODO', 'IN_REVIEW'],
  IN_REVIEW: ['IN_PROGRESS', 'DONE'],
  DONE: ['IN_PROGRESS'],
};
const STATUSES = Object.keys(TRANSITIONS);
const allowedFrom = (s) => TRANSITIONS[s] || [];
const canTransition = (from, to) => allowedFrom(from).includes(to);
module.exports = { STATUSES, allowedFrom, canTransition };
