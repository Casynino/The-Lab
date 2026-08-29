'use strict';

// Standard success envelope so the frontend can rely on a consistent shape:
//   { success: true, data, meta? }
function ok(res, data, meta) {
  const body = { success: true, data };
  if (meta !== undefined) body.meta = meta;
  return res.status(200).json(body);
}

function created(res, data, meta) {
  const body = { success: true, data };
  if (meta !== undefined) body.meta = meta;
  return res.status(201).json(body);
}

function noContent(res) {
  return res.status(204).send();
}

// Paginated list envelope.
function paginated(res, items, { page, limit, total, ...extra }) {
  return res.status(200).json({
    success: true,
    data: items,
    meta: {
      page,
      limit,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      hasMore: page * limit < total,
      // Anything else a caller passes rides along in meta — a page-level summary
      // has to be computed from the whole result set, not the slice being sent.
      ...extra,
    },
  });
}

module.exports = { ok, created, noContent, paginated };
