const { seedAdmins } = require('./seed');
const attachAdminRoutes = require('./routes');

module.exports = function attachAdmin(app, db, JWT_SECRET, io = null) {
  seedAdmins(db);
  attachAdminRoutes(app, db, JWT_SECRET, io);
};

module.exports.ROLES = require('./seed').ROLES;
