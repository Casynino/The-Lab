# ZELab — API Reference

Base URL: `/api` (e.g. `http://localhost:4000/api`).

## Conventions

- **Auth:** send `Authorization: Bearer <accessToken>` on every protected request.
  Obtain tokens from `POST /auth/login`; refresh with `POST /auth/refresh`.
- **Success envelope:** `{ "success": true, "data": <payload>, "meta"?: {...} }`.
  Lists include `meta: { page, limit, total, totalPages, hasMore }`.
- **Error envelope:** `{ "success": false, "error": { "message", "code", "details"? } }`.
- **Pagination/filtering:** list endpoints accept `page`, `limit`, `sortBy`, `sortDir`,
  and `search` plus endpoint-specific filters.
- **Roles:** `ADMIN` (full access), `WAREHOUSE_STAFF`, `SALES_REP`. Admin passes all checks.

---

## Auth

| Method | Path                    | Roles | Notes |
| ------ | ----------------------- | ----- | ----- |
| POST   | `/auth/login`           | —     | `{ email, password }` → `{ user, tokens }` |
| POST   | `/auth/refresh`         | —     | `{ refreshToken }` → `{ tokens }` |
| GET    | `/auth/me`              | any   | Current user profile |
| POST   | `/auth/logout`          | any   | Stateless; audited |
| POST   | `/auth/change-password` | any   | `{ currentPassword, newPassword, confirmPassword }` |

```jsonc
// POST /auth/login
{ "email": "you@example.com", "password": "<your password>" }
```

## Users & roles (Admin)

| Method | Path                  | Notes |
| ------ | --------------------- | ----- |
| GET    | `/users`              | `?roleId&isActive&search` |
| POST   | `/users`              | `{ name, email, password, roleId, warehouseId?, salesRep? }` |
| PUT    | `/users/:id`          | partial; `password` optional |
| DELETE | `/users/:id`          | deactivates (keeps history) |
| GET    | `/roles`              | roles + permissions |
| GET    | `/roles/permissions`  | all permission keys |
| POST/PUT/DELETE | `/roles/:id` | `{ name, description, permissionKeys[] }` |

## Catalog

| Method | Path                         | Roles | Notes |
| ------ | ---------------------------- | ----- | ----- |
| GET    | `/brands`, `/categories`     | any   | `?search&isActive` |
| POST/PUT/DELETE | `/brands/:id` etc. | Admin | `{ name, description? }` |
| GET    | `/packaging-units`           | any   | Pack/Box/Carton… |
| POST/PUT/DELETE | `/packaging-units/:id` | Admin | `{ name, shortCode, level? }` |
| GET    | `/products`                  | any   | `?brandId&categoryId&isActive&search` (returns on-hand) |
| GET    | `/products/:id`              | any   | includes per-location balances |
| POST   | `/products`                  | Admin | see below |
| PUT    | `/products/:id`              | Admin | scalar fields |
| PUT    | `/products/:id/packagings`   | Admin | `{ packagings: [...] }` |
| DELETE | `/products/:id`              | Admin | deletes or deactivates if it has history |

```jsonc
// POST /products
{
  "name": "CIVILLY Small Rolling Paper (78mm) Without Filter",
  "brandId": "<brandId>", "categoryId": "<categoryId>",
  "purchasePrice": 455, "sellingPrice": 700,
  "minStockLevel": 250, "reorderQuantity": 2500,
  "packagings": [
    { "packagingUnitId": "<pack>", "baseQuantity": 1,    "isBaseUnit": true },
    { "packagingUnitId": "<box>",  "baseQuantity": 50 },
    { "packagingUnitId": "<carton>","baseQuantity": 2500 }
  ]
}
```

## Locations

| Method | Path                              | Roles | Notes |
| ------ | --------------------------------- | ----- | ----- |
| GET/POST/PUT/DELETE | `/warehouses`        | read any / write Admin | `{ name, code, region? }` |
| GET    | `/sales-reps`                     | any   | list reps |
| GET    | `/sales-reps/:id`                 | any   | held stock, debt, totals |
| GET    | `/sales-reps/:id/stock`           | any   | current van stock |
| GET    | `/sales-reps/:id/reconciliation`  | any   | assigned vs sold vs returned vs missing |
| POST/PUT/DELETE | `/sales-reps/:id`        | Admin | `{ userId, region?, monthlyTarget? }` |
| GET/POST/PUT/DELETE | `/customers`         | any (reps scoped to own) | `{ name, phone?, region?, salesRepId? }` |

## Inventory (ledger)

| Method | Path                            | Roles | Notes |
| ------ | ------------------------------- | ----- | ----- |
| GET    | `/inventory/balances`           | any   | grouped by product, per-location breakdown |
| GET    | `/inventory/movements`          | any   | raw ledger; `?productId&type&warehouseId&salesRepId&from&to` |
| POST   | `/inventory/stock-in`           | Warehouse | receive into a warehouse |
| POST   | `/inventory/adjustments`        | Warehouse | signed correction with reason |
| POST   | `/inventory/damage`             | Warehouse | write-off |
| POST   | `/inventory/recompute-caches`   | Admin | rebuild cache from ledger |

```jsonc
// POST /inventory/stock-in
{
  "warehouseId": "<id>",
  "type": "STOCK_IN",
  "items": [{ "productId": "<id>", "packagingUnitId": "<cartonId>", "quantity": 3 }],
  "notes": "Opening stock"
}
```

## Transfers

| Method | Path                  | Roles | Notes |
| ------ | --------------------- | ----- | ----- |
| GET    | `/transfers`          | any   | `?direction&status&from&to` |
| GET    | `/transfers/:id`      | any   | |
| POST   | `/transfers`          | Warehouse | dispatch |
| POST   | `/transfers/:id/cancel` | Warehouse | reverses the movement |

```jsonc
// POST /transfers  (assign stock to a rep)
{
  "direction": "WAREHOUSE_TO_REP",
  "fromWarehouseId": "<id>", "toRepId": "<repId>",
  "items": [{ "productId": "<id>", "packagingUnitId": "<boxId>", "quantity": 2 }]
}
```

## Sales

| Method | Path               | Roles | Notes |
| ------ | ------------------ | ----- | ----- |
| GET    | `/sales`           | any (reps scoped) | `?type&status&salesRepId&from&to` |
| GET    | `/sales/:id`       | any (reps scoped) | items + payments |
| POST   | `/sales`           | Rep/Warehouse | cash or credit |
| POST   | `/sales/:id/cancel`| Admin | restores stock |

```jsonc
// POST /sales  (rep credit sale; unitPrice is per chosen packaging unit, optional)
{
  "type": "CREDIT",
  "customerId": "<id>",
  "items": [{ "productId": "<id>", "packagingUnitId": "<packId>", "quantity": 15 }],
  "discount": 0, "amountPaid": 0, "dueDate": "2026-07-16T00:00:00.000Z"
}
```

## Credit & debt

| Method | Path                       | Roles | Notes |
| ------ | -------------------------- | ----- | ----- |
| GET    | `/credit`                  | any (reps scoped) | `?status&overdue&outstanding` |
| GET    | `/credit/summary`          | any   | totals, overdue, top debtors, per-rep |
| GET    | `/credit/:id`              | any   | with payment history |
| POST   | `/credit/:id/payments`     | Rep/Warehouse | `{ amount, method?, reference? }` |
| POST   | `/credit/refresh-overdue`  | Admin | recompute overdue flags |

## Returns

| Method | Path           | Roles | Notes |
| ------ | -------------- | ----- | ----- |
| GET    | `/returns`     | any (reps scoped) | `?type` |
| POST   | `/returns`     | Rep/Warehouse | `CUSTOMER_RETURN` or `SALES_RETURN`; per-item `condition` |

## Stock counts

| Method | Path                    | Roles | Notes |
| ------ | ----------------------- | ----- | ----- |
| GET    | `/stock-counts`         | any   | |
| GET    | `/stock-counts/:id`     | any   | item variances |
| GET    | `/stock-counts/missing` | any   | missing/damaged report |
| POST   | `/stock-counts`         | Warehouse/Rep | reconciles ledger to physical |

## Reports (Admin / Warehouse)

All accept `?period=today|week|month|year` (or `from`/`to`) and `?format=json|pdf|excel`.

`/reports/sales`, `/reports/products`, `/reports/regional`, `/reports/sales-reps`,
`/reports/profit`, `/reports/inventory-valuation`, `/reports/inventory-movements`,
`/reports/debts`.

## Reorder, notifications, audit, dashboard, settings

| Method | Path                         | Roles | Notes |
| ------ | ---------------------------- | ----- | ----- |
| GET    | `/reorder`                   | Warehouse | `?lookbackDays&coverDays` |
| GET    | `/reorder/low-stock`         | Warehouse | |
| GET    | `/notifications`             | any   | `?type&severity&isRead` |
| GET    | `/notifications/unread-count`| any   | |
| POST   | `/notifications/:id/read`    | any   | |
| POST   | `/notifications/read-all`    | any   | |
| POST   | `/notifications/generate`    | Admin | scan state & raise alerts |
| GET    | `/audit-logs`                | Admin | `?userId&entityType&action&from&to&search` |
| GET    | `/dashboard`                 | Warehouse | management overview |
| GET    | `/dashboard/me`              | any   | personal (sales-rep) overview |
| GET    | `/settings` `/settings/:key` | any   | |
| PUT    | `/settings/:key`             | Admin | `{ value, type?, group? }` |

## Health

`GET /api/health` → `{ success, data: { status: "ok", time } }` (no auth).
