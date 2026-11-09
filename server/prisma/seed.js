'use strict';

/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// ZELab (was Hao Stock) — LIVE seed.
// Real opening data only: the 8 OHIS/CIVILLY products with their real box
// counts and box prices. No demo customers, reps, sales, orders or imports.
// Everything is stored in BOXES (base unit); 1 Carton = 50 Boxes for receiving.
// ---------------------------------------------------------------------------
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const env = require('../src/config/env');
const inventory = require('../src/services/inventory.service');

// --- RBAC -------------------------------------------------------------------
const PERMISSIONS = [
  ['dashboard:view', 'View dashboards'],
  ['product:manage', 'Create/update products & catalog'],
  ['inventory:manage', 'Receive, adjust and write off stock'],
  ['transfer:manage', 'Dispatch and process stock transfers'],
  ['stockcount:manage', 'Conduct physical stock counts'],
  ['return:manage', 'Process returns'],
  ['sale:create', 'Record sales'],
  ['sale:manage', 'Cancel/override sales'],
  ['customer:manage', 'Manage customers'],
  ['credit:manage', 'Manage credit and record payments'],
  ['report:view', 'View and export reports'],
  ['user:manage', 'Manage users and roles'],
  ['settings:manage', 'Configure system settings'],
];

const ROLES = {
  ADMIN: PERMISSIONS.map((p) => p[0]),
  WAREHOUSE_STAFF: ['dashboard:view', 'inventory:manage', 'transfer:manage', 'stockcount:manage', 'return:manage', 'report:view', 'customer:manage'],
  SALES_REP: ['sale:create', 'customer:manage', 'credit:manage', 'return:manage'],
};

// --- The ONLY products (real data) -----------------------------------------
// boxPrice = selling price per Box (TZS). boxes = opening stock on hand.
const PRODUCTS = [
  // OHIS
  { brand: 'OHIS', sku: 'OHI-PN-BF', name: 'Pepa Ndogo (Bila Filter)', boxPrice: 30000, boxes: 0 },
  { brand: 'OHIS', sku: 'OHI-PK-BF', name: 'Pepa Kubwa (Bila Filter)', boxPrice: 32500, boxes: 30 },
  { brand: 'OHIS', sku: 'OHI-PN-NF', name: 'Pepa Ndogo (Na Filter)', boxPrice: 36000, boxes: 60 },
  { brand: 'OHIS', sku: 'OHI-PK-NF', name: 'Pepa Kubwa (Na Filter)', boxPrice: 48000, boxes: 11 },
  // CIVILLY
  { brand: 'CIVILLY', sku: 'CIV-PN-BF', name: 'Pepa Ndogo (Bila Filter)', boxPrice: 35000, boxes: 112 },
  { brand: 'CIVILLY', sku: 'CIV-PK-BF', name: 'Pepa Kubwa (Bila Filter)', boxPrice: 40000, boxes: 0 },
  { brand: 'CIVILLY', sku: 'CIV-PN-NF', name: 'Pepa Ndogo (Na Filter)', boxPrice: 43000, boxes: 44 },
  { brand: 'CIVILLY', sku: 'CIV-PK-NF', name: 'Pepa Kubwa (Na Filter)', boxPrice: 60000, boxes: 39 },
];

const CARTON_BOXES = 50; // 1 Carton = 50 Boxes (used only when receiving cartons)

async function main() {
  console.log('Seeding ZELab (live data)...\n');

  // Permissions
  for (const [key, description] of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  // Roles
  const roles = {};
  for (const [name, keys] of Object.entries(ROLES)) {
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
    roles[name] = await prisma.role.upsert({
      where: { name },
      update: { isSystem: true, permissions: { set: perms.map((p) => ({ id: p.id })) } },
      create: { name, isSystem: true, description: `${name} role`, permissions: { connect: perms.map((p) => ({ id: p.id })) } },
    });
  }
  console.log('✔ roles & permissions');

  // Home warehouse
  const warehouse = await prisma.warehouse.upsert({
    where: { code: 'WH-MAIN' },
    update: {},
    create: { name: 'Main Warehouse (Home)', code: 'WH-MAIN', region: 'Dar es Salaam', isPrimary: true },
  });

  // Admin (owner) — the only user; create reps later from the Users page.
  // Refuse to seed with a guessable/absent password. A published default would
  // hand admin access to anyone who reads this repo.
  if (!env.seed.adminPassword || String(env.seed.adminPassword).length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD is required (min 8 chars). Set it before seeding — there is no default.');
  }
  const passwordHash = await bcrypt.hash(env.seed.adminPassword, env.bcryptSaltRounds);
  const admin = await prisma.user.upsert({
    where: { email: env.seed.adminEmail.toLowerCase() },
    update: { name: env.seed.adminName, roleId: roles.ADMIN.id },
    create: { name: env.seed.adminName, email: env.seed.adminEmail.toLowerCase(), passwordHash, roleId: roles.ADMIN.id },
  });
  console.log('✔ admin user');

  // Packaging units: Box (base) + Carton (50 boxes)
  const box = await prisma.packagingUnit.upsert({ where: { name: 'Box' }, update: { level: 0 }, create: { name: 'Box', shortCode: 'BX', level: 0, description: 'Base sellable unit' } });
  const carton = await prisma.packagingUnit.upsert({ where: { name: 'Carton' }, update: { level: 1 }, create: { name: 'Carton', shortCode: 'CT', level: 1, description: '50 boxes' } });

  // Brand + category
  const brands = {};
  for (const name of ['OHIS', 'CIVILLY']) {
    brands[name] = await prisma.brand.upsert({ where: { name }, update: {}, create: { name } });
  }
  const category = await prisma.category.upsert({ where: { name: 'Rolling Papers' }, update: {}, create: { name: 'Rolling Papers' } });
  console.log('✔ brands, category, packaging units');

  // Products (Swahili names) + Box/Carton packaging
  const created = [];
  for (const p of PRODUCTS) {
    const fullName = `${p.brand} ${p.name}`; // e.g. "OHIS Pepa Ndogo (Bila Filter)"
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: { name: fullName, brandId: brands[p.brand].id, categoryId: category.id, baseUnitName: 'Box', sellingPrice: p.boxPrice },
      create: {
        name: fullName,
        sku: p.sku,
        brandId: brands[p.brand].id,
        categoryId: category.id,
        baseUnitName: 'Box',
        // Cost basis defaults to the box price so stock value isn't zero; the
        // real landed cost auto-replaces it when you receive a China PO.
        purchasePrice: p.boxPrice,
        sellingPrice: p.boxPrice,
        minStockLevel: 10,
        reorderQuantity: CARTON_BOXES,
      },
    });
    for (const k of [
      { unitId: box.id, base: 1, price: null, isBase: true },
      { unitId: carton.id, base: CARTON_BOXES, price: p.boxPrice * CARTON_BOXES, isBase: false },
    ]) {
      await prisma.productPackaging.upsert({
        where: { productId_packagingUnitId: { productId: product.id, packagingUnitId: k.unitId } },
        update: { baseQuantity: k.base, unitPrice: k.price, isBaseUnit: k.isBase },
        create: { productId: product.id, packagingUnitId: k.unitId, baseQuantity: k.base, unitPrice: k.price, isBaseUnit: k.isBase },
      });
    }
    created.push({ ...p, id: product.id, boxUnitId: box.id });
  }
  console.log(`✔ ${created.length} products (OHIS + CIVILLY, prices per Box)`);

  // Settings (commission rule + business config)
  const settingDefs = [
    { key: 'business.name', value: 'ZELab', group: 'business' },
    { key: 'business.currency', value: env.business.currency, group: 'business' },
    { key: 'business.country', value: 'Tanzania', group: 'business' },
    { key: 'credit.defaultTermDays', value: String(env.business.defaultCreditTermDays), type: 'NUMBER', group: 'credit' },
    { key: 'reorder.lookbackDays', value: String(env.business.reorderLookbackDays), type: 'NUMBER', group: 'reorder' },
    { key: 'reorder.coverDays', value: '30', type: 'NUMBER', group: 'reorder' },
    { key: 'commission.v1PerBox', value: '5000', type: 'NUMBER', group: 'commission', description: 'Commission per box for orders issued before 1 Aug 2026. Historical fact — frozen so past earnings cannot be re-priced.' },
    { key: 'commission.amountPerThreshold', value: '250000', type: 'NUMBER', group: 'commission', description: 'Minimum commission balance a rep must reach to request a withdrawal. Money only — it no longer affects any per-box rate.' },
    { key: 'commission.boxThreshold', value: '50', type: 'NUMBER', group: 'commission', description: 'Legacy. Superseded by commission.v1PerBox and no longer read.' },
    { key: 'settlement.windowHours', value: '72', type: 'NUMBER', group: 'settlement' },
  ];
  // Values the API refuses to change, so re-seeding must not change them either.
  // A deployment whose withdrawal minimum was never 250,000 has a frozen V1 rate
  // that is not 5,000 (300,000 / 50 = 6,000), and overwriting it here would
  // re-price every box settled on every pre-August order.
  const FROZEN = new Set(['commission.v1PerBox', 'commission.boxThreshold']);
  for (const s of settingDefs) {
    await prisma.setting.upsert({
      where: { key: s.key },
      // Descriptions are what stop the next person reading a bare "50" in the
      // Settings screen as a target, so they are refreshed even when frozen.
      update: FROZEN.has(s.key)
        ? { description: s.description ?? undefined }
        : { value: s.value, description: s.description ?? undefined },
      create: {
        key: s.key,
        value: s.value,
        type: s.type || 'STRING',
        group: s.group,
        description: s.description || null,
        updatedById: admin.id,
      },
    });
  }
  console.log('✔ settings (commission: OHIS 5,000 / Civlily 3,000 per box from 1 Aug 2026; withdraw at 250,000)');

  // Opening warehouse stock — exact box counts (skip products with 0 boxes).
  // Only set once, so re-running the seed never double-stocks.
  const existingTxns = await prisma.inventoryTransaction.count();
  if (existingTxns === 0) {
    await prisma.$transaction(async (tx) => {
      for (const p of created) {
        if (p.boxes <= 0) continue;
        await inventory.increaseStock(tx, {
          productId: p.id,
          packagingUnitId: p.boxUnitId,
          quantity: p.boxes,
          baseQuantity: p.boxes, // Box is the base unit
          type: 'STOCK_IN',
          location: { type: inventory.LOCATION.WAREHOUSE, warehouseId: warehouse.id },
          unitCost: p.boxPrice,
          referenceType: 'MANUAL',
          userId: admin.id,
          notes: 'Opening stock count',
        });
      }
    });
    const stocked = created.filter((p) => p.boxes > 0);
    console.log(`✔ opening stock set for ${stocked.length} products:`);
    stocked.forEach((p) => console.log(`   • ${p.brand} ${p.name}: ${p.boxes} boxes`));
  } else {
    console.log('• ledger already has movements — opening stock left untouched');
  }

  console.log('\n✅ Seed complete. System ready for live usage.');
  console.log(`\nLog in as admin:  ${env.seed.adminEmail}  /  (the SEED_ADMIN_PASSWORD you set)`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
