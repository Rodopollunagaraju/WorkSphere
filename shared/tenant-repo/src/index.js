const { BadRequest } = require('@worksphere/errors');

const BANNED = new Set(['$where', '$function', '$accumulator']);
function assertSafe(node) {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (BANNED.has(k)) throw BadRequest(`Operator ${k} is not allowed`);
    assertSafe(v);
  }
}
function stripOrg(update) {
  const u = { ...update };
  for (const op of ['$set', '$setOnInsert', '$unset']) {
    if (u[op]) {
      if ('organizationId' in u[op]) throw BadRequest('organizationId cannot be modified');
      u[op] = { ...u[op] };
    }
  }
  if ('organizationId' in u) throw BadRequest('organizationId cannot be modified');
  return u;
}

// The ONLY door to a collection: every operation is AND-ed with the tenant, and the
// tenant filter is applied last so user input can never override it.
class ScopedRepository {
  constructor(model, orgId) {
    if (typeof orgId !== 'string' || !orgId) throw BadRequest('Organization context required');
    this.model = model;
    this.orgId = orgId;
    Object.freeze(this);
  }
  _f(filter = {}) { assertSafe(filter); return { $and: [filter, { organizationId: this.orgId }] }; }
  find(filter, { sort, limit, skip, select, session } = {}) {
    let q = this.model.find(this._f(filter));
    if (sort) q = q.sort(sort);
    if (skip) q = q.skip(skip);
    if (limit) q = q.limit(limit);
    if (select) q = q.select(select);
    if (session) q = q.session(session);
    return q.lean();
  }
  findOne(filter, { session, select } = {}) {
    let q = this.model.findOne(this._f(filter));
    if (select) q = q.select(select);
    if (session) q = q.session(session);
    return q.lean();
  }
  findById(id, opts) { return this.findOne({ _id: id }, opts); }
  count(filter, { session } = {}) {
    const q = this.model.countDocuments(this._f(filter));
    return session ? q.session(session) : q;
  }
  async create(docs, { session } = {}) {
    const many = Array.isArray(docs);
    const list = (many ? docs : [docs]).map((d) => ({ ...d, organizationId: this.orgId }));
    const created = await this.model.create(list, { session });
    const plain = created.map((c) => (c.toObject ? c.toObject() : c));
    return many ? plain : plain[0];
  }
  updateOne(filter, update, { session } = {}) {
    return this.model.updateOne(this._f(filter), stripOrg(update), { session });
  }
  findOneAndUpdate(filter, update, { session, upsert = false } = {}) {
    return this.model.findOneAndUpdate(this._f(filter), stripOrg(update), { session, upsert, new: true }).lean();
  }
  updateMany(filter, update, { session } = {}) {
    return this.model.updateMany(this._f(filter), stripOrg(update), { session });
  }
  deleteOne(filter, { session } = {}) { return this.model.deleteOne(this._f(filter), { session }); }
  deleteMany(filter, { session } = {}) { return this.model.deleteMany(this._f(filter), { session }); }
  aggregate(pipeline) {
    assertSafe(pipeline);
    return this.model.aggregate([{ $match: { organizationId: this.orgId } }, ...pipeline]);
  }
}

class TenantRepository {
  constructor(model) { this.model = model; }
  forOrg(orgId) { return new ScopedRepository(this.model, orgId); }
}

module.exports = { TenantRepository, ScopedRepository };
