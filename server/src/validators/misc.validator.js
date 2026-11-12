'use strict';

const { z } = require('zod');
const { paginationFields, dateRangeFields, boolQuery, id } = require('./common.validator');

const notificationQuery = {
  query: z.object({
    ...paginationFields,
    type: z
      .enum(['LOW_STOCK', 'REORDER', 'OVERDUE_DEBT', 'MISSING_INVENTORY', 'OUTSTANDING_REP_STOCK', 'GENERAL'])
      .optional(),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
    isRead: boolQuery,
  }),
};

const auditQuery = {
  query: z.object({
    ...paginationFields,
    ...dateRangeFields,
    userId: id.optional(),
    entityType: z.string().optional(),
    action: z.string().optional(),
    // The codes whose words on the page match the search (see auditLogs.controller searchWhere).
    searchActions: z.string().max(2000).optional(),
    searchEntities: z.string().max(2000).optional(),
  }),
};

const settingUpsert = {
  params: z.object({ key: z.string().min(1).max(120) }),
  body: z.object({
    value: z.string().max(2000),
    type: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'JSON']).optional(),
    group: z.string().max(60).optional(),
    description: z.string().max(300).optional().nullable(),
  }),
};

const roleUpsert = {
  body: z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(300).optional().nullable(),
    permissionKeys: z.array(z.string()).optional(),
  }),
};

module.exports = { notificationQuery, auditQuery, settingUpsert, roleUpsert };
