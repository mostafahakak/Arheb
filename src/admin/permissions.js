'use strict';

/**
 * Central permission system for dashboard staff.
 *
 * SuperAdmin and Admin keep full access. The 10 staff roles below get a fixed
 * set of permissions taken from the permissions spreadsheet. `store_admin`
 * (merchant) is unrelated to these permissions and is handled by its own
 * store-scoped checks.
 */

const PERMISSIONS = Object.freeze({
  ORDERS_VIEW: 'orders.view',
  ORDERS_EDIT: 'orders.edit',
  ORDERS_DELETE: 'orders.delete',
  STORES_VIEW: 'stores.view',
  STORES_ADD: 'stores.add',
  STORES_EDIT: 'stores.edit',
  INVOICES_VIEW: 'invoices.view',
  USERS_VIEW: 'users.view',
  DRIVERS_VIEW: 'drivers.view',
  DRIVERS_EDIT: 'drivers.edit',
  DRIVERS_DELETE: 'drivers.delete',
  DRIVERS_REASSIGN: 'drivers.reassign',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_EDIT: 'settings.edit',
  APPINFO_VIEW: 'appinfo.view',
  FEES_DELIVERY_EDIT: 'fees.delivery.edit',
  FEES_LOCATION_EDIT: 'fees.location.edit',
  LOGS_VIEW: 'logs.view',
  TRACKING_VIEW: 'tracking.view',
  CATEGORIES_VIEW: 'categories.view',
  CATEGORIES_EDIT: 'categories.edit',
  ADMINS_VIEW: 'admins.view',
  ADMINS_EDIT: 'admins.edit',
  ADMINS_ADD: 'admins.add',
  NOTIFICATIONS_MANAGE: 'notifications.manage',
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_ADD: 'products.add',
  PRODUCTS_EDIT: 'products.edit',
  PERMISSIONS_SET: 'permissions.set',
});

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

/** Built-in roles that always have full access. */
const FULL_ACCESS_ROLES = Object.freeze(['superadmin', 'admin']);

/** Merchant role; not part of the staff permission matrix. */
const STORE_ADMIN_ROLE = 'store_admin';

const P = PERMISSIONS;

/** Staff roles (dashboard) and their fixed permission presets (from the sheet). */
const STAFF_ROLE_PERMISSIONS = Object.freeze({
  finance_manager: [
    P.ORDERS_VIEW,
    P.STORES_VIEW, P.STORES_ADD, P.STORES_EDIT,
    P.INVOICES_VIEW,
    P.USERS_VIEW,
    P.DRIVERS_VIEW, P.DRIVERS_EDIT,
    P.APPINFO_VIEW,
    P.FEES_DELIVERY_EDIT, P.FEES_LOCATION_EDIT,
    P.LOGS_VIEW,
    P.CATEGORIES_VIEW, P.CATEGORIES_EDIT,
    P.ADMINS_VIEW, P.ADMINS_EDIT, P.ADMINS_ADD,
    P.PRODUCTS_VIEW, P.PRODUCTS_ADD, P.PRODUCTS_EDIT,
  ],
  finance_officer: [
    P.ORDERS_VIEW,
    P.STORES_VIEW,
    P.INVOICES_VIEW,
    P.DRIVERS_VIEW, P.DRIVERS_EDIT,
    P.APPINFO_VIEW,
    P.LOGS_VIEW,
    P.CATEGORIES_VIEW,
    P.ADMINS_VIEW, P.ADMINS_EDIT,
    P.PRODUCTS_VIEW,
  ],
  call_admin: [
    P.ORDERS_VIEW, P.ORDERS_EDIT,
    P.STORES_VIEW, P.STORES_ADD, P.STORES_EDIT,
    P.USERS_VIEW,
    P.DRIVERS_VIEW,
    P.SETTINGS_VIEW, P.SETTINGS_EDIT,
    P.TRACKING_VIEW,
    P.NOTIFICATIONS_MANAGE,
    P.DRIVERS_REASSIGN,
    P.PRODUCTS_VIEW, P.PRODUCTS_ADD, P.PRODUCTS_EDIT,
  ],
  call_agent: [
    P.ORDERS_VIEW, P.ORDERS_EDIT,
    P.STORES_VIEW,
    P.DRIVERS_VIEW,
    P.SETTINGS_VIEW,
    P.TRACKING_VIEW,
    P.NOTIFICATIONS_MANAGE,
    P.DRIVERS_REASSIGN,
    P.PRODUCTS_VIEW,
  ],
  driver_supermanager: [
    P.ORDERS_VIEW,
    P.STORES_VIEW,
    P.DRIVERS_VIEW, P.DRIVERS_EDIT, P.DRIVERS_DELETE,
    P.TRACKING_VIEW,
    P.DRIVERS_REASSIGN,
    P.PRODUCTS_VIEW,
  ],
  driver_manager: [
    P.ORDERS_VIEW,
    P.STORES_VIEW,
    P.DRIVERS_VIEW, P.DRIVERS_EDIT,
    P.TRACKING_VIEW,
    P.DRIVERS_REASSIGN,
    P.PRODUCTS_VIEW,
  ],
  data_manager: [
    P.STORES_VIEW, P.STORES_ADD,
    // View drivers added to resolve sheet contradiction (edit/delete without view).
    P.DRIVERS_VIEW, P.DRIVERS_EDIT, P.DRIVERS_DELETE,
    P.SETTINGS_VIEW, P.SETTINGS_EDIT,
    P.LOGS_VIEW,
    P.CATEGORIES_VIEW, P.CATEGORIES_EDIT,
    P.PRODUCTS_VIEW, P.PRODUCTS_ADD, P.PRODUCTS_EDIT,
  ],
  data_agent: [
    P.STORES_VIEW, P.STORES_ADD,
    // View drivers added to resolve sheet contradiction (edit without view).
    P.DRIVERS_VIEW, P.DRIVERS_EDIT,
    P.SETTINGS_VIEW, P.SETTINGS_EDIT,
    P.CATEGORIES_VIEW, P.CATEGORIES_EDIT,
    P.PRODUCTS_VIEW, P.PRODUCTS_ADD, P.PRODUCTS_EDIT,
  ],
  sales_manager: [
    P.ORDERS_VIEW, P.ORDERS_EDIT, P.ORDERS_DELETE,
    P.STORES_VIEW, P.STORES_ADD,
    P.USERS_VIEW,
    P.DRIVERS_VIEW,
    P.SETTINGS_VIEW, P.SETTINGS_EDIT,
    P.CATEGORIES_VIEW, P.CATEGORIES_EDIT,
    P.PRODUCTS_VIEW, P.PRODUCTS_ADD, P.PRODUCTS_EDIT,
  ],
  sales_agent: [
    P.ORDERS_VIEW, P.ORDERS_EDIT,
    P.STORES_VIEW, P.STORES_ADD, P.STORES_EDIT,
    P.DRIVERS_VIEW,
    P.SETTINGS_VIEW,
    P.CATEGORIES_VIEW, P.CATEGORIES_EDIT,
    P.PRODUCTS_VIEW,
  ],
});

const STAFF_ROLES = Object.freeze(Object.keys(STAFF_ROLE_PERMISSIONS));

/** All roles that can sign into the dashboard as staff (full-access + staff presets). */
const DASHBOARD_STAFF_ROLES = Object.freeze([...FULL_ACCESS_ROLES, ...STAFF_ROLES]);

/** Roles the create/edit-admin endpoints accept (excludes superadmin special case). */
const ASSIGNABLE_ROLES = Object.freeze([
  'admin',
  STORE_ADMIN_ROLE,
  ...STAFF_ROLES,
]);

const ALL_KNOWN_ROLES = Object.freeze([
  'superadmin',
  'admin',
  STORE_ADMIN_ROLE,
  ...STAFF_ROLES,
]);

function isFullAccessRole(role) {
  return FULL_ACCESS_ROLES.includes(role);
}

/** Returns the list of permission keys for a role. */
function getPermissionsForRole(role) {
  if (isFullAccessRole(role)) return [...ALL_PERMISSIONS];
  if (STAFF_ROLE_PERMISSIONS[role]) return [...STAFF_ROLE_PERMISSIONS[role]];
  return [];
}

function roleHasPermission(role, permission) {
  if (isFullAccessRole(role)) return true;
  const perms = STAFF_ROLE_PERMISSIONS[role];
  return Array.isArray(perms) && perms.includes(permission);
}

/** True if the role has at least one of the listed permissions. */
function roleHasAnyPermission(role, permissions) {
  if (isFullAccessRole(role)) return true;
  return (permissions || []).some((p) => roleHasPermission(role, p));
}

module.exports = {
  PERMISSIONS,
  ALL_PERMISSIONS,
  FULL_ACCESS_ROLES,
  STORE_ADMIN_ROLE,
  STAFF_ROLE_PERMISSIONS,
  STAFF_ROLES,
  DASHBOARD_STAFF_ROLES,
  ASSIGNABLE_ROLES,
  ALL_KNOWN_ROLES,
  isFullAccessRole,
  getPermissionsForRole,
  roleHasPermission,
  roleHasAnyPermission,
};
