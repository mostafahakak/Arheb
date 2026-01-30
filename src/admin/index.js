const { seedAdmins } = require('./seed');
const attachAdminRoutes = require('./routes');

module.exports = function attachAdmin(app, db, JWT_SECRET) {
  seedAdmins(db);
  attachAdminRoutes(app, db, JWT_SECRET);
};

module.exports.ROLES = require('./seed').ROLES;
