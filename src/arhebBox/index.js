const fcm = require('../fcm');

module.exports = function attachArhebBoxRoutes(app, db, authenticateRequest) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS arheb_box_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phoneNumber TEXT NOT NULL,
      userName TEXT,
      pickup TEXT NOT NULL,
      dropoff TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      fcmToken TEXT,
      driverId INTEGER,
      driverName TEXT,
      receiverPhone TEXT,
      receiverName TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    db.exec('ALTER TABLE arheb_box_requests ADD COLUMN fcmToken TEXT');
  } catch (e) { /* exists */ }
  try {
    db.exec('ALTER TABLE arheb_box_requests ADD COLUMN driverId INTEGER');
  } catch (e) { /* exists */ }
  try {
    db.exec('ALTER TABLE arheb_box_requests ADD COLUMN driverName TEXT');
  } catch (e) { /* exists */ }
  try {
    db.exec('ALTER TABLE arheb_box_requests ADD COLUMN receiverPhone TEXT');
  } catch (e) { /* exists */ }
  try {
    db.exec('ALTER TABLE arheb_box_requests ADD COLUMN receiverName TEXT');
  } catch (e) { /* exists */ }

  const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');
  const insertRequest = db.prepare(`
    INSERT INTO arheb_box_requests (phoneNumber, userName, pickup, dropoff, notes, status, fcmToken, receiverPhone, receiverName)
    VALUES (@phoneNumber, @userName, @pickup, @dropoff, @notes, @status, @fcmToken, @receiverPhone, @receiverName)
  `);

  app.post('/api/arheb-box', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const user = findUserByPhone.get(phoneNumber);
      const userName = user?.name || null;

      const { pickup, dropoff, notes, fcmToken, receiverPhone, receiverName } = req.body || {};
      const fcmTokenStr = typeof fcmToken === 'string' ? fcmToken.trim() || null : null;
      if (fcmTokenStr) {
        try {
          db.prepare('UPDATE users SET fcmToken = ? WHERE phoneNumber = ?').run(fcmTokenStr, phoneNumber);
        } catch (e) { /* ignore */ }
      }

      if (!pickup || typeof pickup !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'pickup is required and must be an object with latitude, longitude, address'
        });
      }
      if (typeof pickup.latitude !== 'number' || isNaN(pickup.latitude)) {
        return res.status(400).json({
          success: false,
          message: 'pickup.latitude must be a valid number'
        });
      }
      if (typeof pickup.longitude !== 'number' || isNaN(pickup.longitude)) {
        return res.status(400).json({
          success: false,
          message: 'pickup.longitude must be a valid number'
        });
      }

      if (!dropoff || typeof dropoff !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'dropoff is required and must be an object with latitude, longitude, address'
        });
      }
      if (typeof dropoff.latitude !== 'number' || isNaN(dropoff.latitude)) {
        return res.status(400).json({
          success: false,
          message: 'dropoff.latitude must be a valid number'
        });
      }
      if (typeof dropoff.longitude !== 'number' || isNaN(dropoff.longitude)) {
      const recvPhoneStr = receiverPhone != null ? String(receiverPhone).trim() : '';
      const recvNameStr = receiverName != null ? String(receiverName).trim() : '';
      if (!recvPhoneStr) {
        return res.status(400).json({
          success: false,
          message: 'receiverPhone is required',
        });
      }
      if (!recvNameStr) {
        return res.status(400).json({
          success: false,
          message: 'receiverName is required',
        });
      }

        return res.status(400).json({
          success: false,
          message: 'dropoff.longitude must be a valid number'
        });
      }

      const pickupJson = JSON.stringify({
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        address: pickup.address != null ? String(pickup.address) : ''
      });
      const dropoffJson = JSON.stringify({
        latitude: dropoff.latitude,
        longitude: dropoff.longitude,
        address: dropoff.address != null ? String(dropoff.address) : ''
      });
      const notesStr = notes != null ? String(notes) : '';

      const result = insertRequest.run({
        phoneNumber,
        userName,
        pickup: pickupJson,
        dropoff: dropoffJson,
        notes: notesStr,
        status: 'pending',
        fcmToken: fcmTokenStr,
        receiverPhone: recvPhoneStr,
        receiverName: recvNameStr,
      });

      const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(result.lastInsertRowid);
      const pickupObj = (() => { try { return JSON.parse(row.pickup); } catch (e) { return {}; } })();
      const dropoffObj = (() => { try { return JSON.parse(row.dropoff); } catch (e) { return {}; } })();
      const buildMapsUrl = (loc) => {
        if (!loc) return null;
        if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
          return `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
        }
        if (loc.address) {
          return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}`;
        }
        return null;
      };
      const pickupWithMaps = { ...pickupObj, mapsUrl: buildMapsUrl(pickupObj) };
      const dropoffWithMaps = { ...dropoffObj, mapsUrl: buildMapsUrl(dropoffObj) };

      return res.status(201).json({
        success: true,
        message: 'Arheb box request received successfully',
        data: {
          request: {
            id: row.id,
            phoneNumber: row.phoneNumber,
            userName: row.userName,
            senderPhone: row.phoneNumber,
            receiverPhone: row.receiverPhone || null,
            receiverName: row.receiverName || null,
            pickup: pickupWithMaps,
            dropoff: dropoffWithMaps,
            notes: row.notes,
            status: row.status,
            fcmToken: row.fcmToken ? true : false,
            createdAt: row.createdAt
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Arheb box error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });
};
