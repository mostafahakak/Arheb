module.exports = function attachProfileRoutes(app, db, authenticateRequest) {
  const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');

  function parseAddresses(user) {
    if (user.addresses) {
      try {
        const arr = JSON.parse(user.addresses);
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        return [];
      }
    }
    // Migration: legacy single address
    if (user.addressName != null || user.addressLong != null || user.addressLat != null) {
      return [{
        addressName: user.addressName || null,
        addressLong: user.addressLong ?? null,
        addressLat: user.addressLat ?? null
      }];
    }
    return [];
  }

  // Get user profile (addresses list; first is default)
  app.get('/api/profile', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const user = findUserByPhone.get(phoneNumber);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const addresses = parseAddresses(user);

      return res.status(200).json({
        success: true,
        message: 'Profile retrieved successfully',
        data: {
          profile: {
            phoneNumber: user.phoneNumber,
            name: user.name || null,
            addresses,
            defaultAddress: addresses.length > 0 ? addresses[0] : null
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  /**
   * In-app notification history for the authenticated user only (Bearer user JWT).
   * Same user as FCM registration via PUT /api/profile { fcmToken }.
   * Query: page (default 1), perPage (default 20, max 50).
   */
  app.get('/api/profile/notifications', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const perPage = Math.min(50, Math.max(1, parseInt(req.query.perPage, 10) || 20));
      const offset = (page - 1) * perPage;

      let rows = [];
      let total = 0;
      try {
        rows = db
          .prepare(
            `SELECT id, title, body, imageUrl, dataJson, createdAt
             FROM user_notifications
             WHERE phoneNumber = ?
             ORDER BY datetime(createdAt) DESC, id DESC
             LIMIT ? OFFSET ?`
          )
          .all(phoneNumber, perPage, offset);
        total = db.prepare('SELECT COUNT(*) AS c FROM user_notifications WHERE phoneNumber = ?').get(phoneNumber)?.c ?? 0;
      } catch (e) {
        if (e.message && e.message.includes('no such table')) {
          return res.status(200).json({
            success: true,
            message: 'No notifications yet',
            data: { notifications: [], page, perPage, total: 0 },
            timestamp: new Date().toISOString(),
          });
        }
        throw e;
      }

      const notifications = rows.map((r) => {
        let data = null;
        if (r.dataJson) {
          try {
            data = JSON.parse(r.dataJson);
          } catch {
            data = null;
          }
        }
        return {
          id: r.id,
          title: r.title,
          body: r.body,
          imageUrl: r.imageUrl,
          data,
          createdAt: r.createdAt,
        };
      });

      return res.status(200).json({
        success: true,
        message: 'Notifications retrieved successfully',
        data: {
          notifications,
          page,
          perPage,
          total,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('List user notifications error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  });

  // Update user profile (name, fcmToken)
  app.put('/api/profile', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const { name, fcmToken } = req.body || {};

      if (name === undefined && fcmToken === undefined) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }

      const updates = [];
      const values = { phoneNumber };
      if (name !== undefined) {
        updates.push('name = @name');
        values.name = name || null;
      }
      if (fcmToken !== undefined) {
        updates.push('fcmToken = @fcmToken');
        values.fcmToken = typeof fcmToken === 'string' ? fcmToken.trim() || null : null;
      }
      if (updates.length) {
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE phoneNumber = @phoneNumber`).run(values);
      }

      const user = findUserByPhone.get(phoneNumber);
      const addresses = parseAddresses(user);

      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          profile: {
            phoneNumber: user.phoneNumber,
            name: user.name || null,
            addresses,
            defaultAddress: addresses.length > 0 ? addresses[0] : null
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Profile update error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  // Add address (append or insert as default)
  app.post('/api/profile/addresses', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const { addressName, addressLong, addressLat, setAsDefault } = req.body || {};

      if (typeof addressLong !== 'number' || isNaN(addressLong)) {
        return res.status(400).json({
          success: false,
          message: 'addressLong must be a valid number'
        });
      }
      if (typeof addressLat !== 'number' || isNaN(addressLat)) {
        return res.status(400).json({
          success: false,
          message: 'addressLat must be a valid number'
        });
      }

      const user = findUserByPhone.get(phoneNumber);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const addresses = parseAddresses(user);
      const newAddr = {
        addressName: addressName || null,
        addressLong,
        addressLat
      };

      if (setAsDefault) {
        addresses.unshift(newAddr);
      } else {
        addresses.push(newAddr);
      }

      const updateUser = db.prepare('UPDATE users SET addresses = @addresses WHERE phoneNumber = @phoneNumber');
      updateUser.run({
        addresses: JSON.stringify(addresses),
        phoneNumber
      });

      const updated = findUserByPhone.get(phoneNumber);
      const newAddresses = parseAddresses(updated);

      return res.status(201).json({
        success: true,
        message: 'Address added successfully',
        data: {
          profile: {
            phoneNumber: updated.phoneNumber,
            name: updated.name || null,
            addresses: newAddresses,
            defaultAddress: newAddresses.length > 0 ? newAddresses[0] : null
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Add address error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  // Update address at index
  app.put('/api/profile/addresses/:index', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const index = parseInt(req.params.index, 10);
      const { addressName, addressLong, addressLat } = req.body || {};

      if (isNaN(index) || index < 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid address index'
        });
      }

      if (addressLong !== undefined && (typeof addressLong !== 'number' || isNaN(addressLong))) {
        return res.status(400).json({
          success: false,
          message: 'addressLong must be a valid number'
        });
      }
      if (addressLat !== undefined && (typeof addressLat !== 'number' || isNaN(addressLat))) {
        return res.status(400).json({
          success: false,
          message: 'addressLat must be a valid number'
        });
      }

      const user = findUserByPhone.get(phoneNumber);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const addresses = parseAddresses(user);
      if (index >= addresses.length) {
        return res.status(404).json({
          success: false,
          message: 'Address not found'
        });
      }

      if (addressName !== undefined) addresses[index].addressName = addressName || null;
      if (addressLong !== undefined) addresses[index].addressLong = addressLong;
      if (addressLat !== undefined) addresses[index].addressLat = addressLat;

      const updateUser = db.prepare('UPDATE users SET addresses = @addresses WHERE phoneNumber = @phoneNumber');
      updateUser.run({
        addresses: JSON.stringify(addresses),
        phoneNumber
      });

      const updated = findUserByPhone.get(phoneNumber);
      const newAddresses = parseAddresses(updated);

      return res.status(200).json({
        success: true,
        message: 'Address updated successfully',
        data: {
          profile: {
            phoneNumber: updated.phoneNumber,
            name: updated.name || null,
            addresses: newAddresses,
            defaultAddress: newAddresses.length > 0 ? newAddresses[0] : null
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Update address error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  // Delete address at index
  app.delete('/api/profile/addresses/:index', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const index = parseInt(req.params.index, 10);

      if (isNaN(index) || index < 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid address index'
        });
      }

      const user = findUserByPhone.get(phoneNumber);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const addresses = parseAddresses(user);
      if (index >= addresses.length) {
        return res.status(404).json({
          success: false,
          message: 'Address not found'
        });
      }

      addresses.splice(index, 1);

      const updateUser = db.prepare('UPDATE users SET addresses = @addresses WHERE phoneNumber = @phoneNumber');
      updateUser.run({
        addresses: JSON.stringify(addresses),
        phoneNumber
      });

      const updated = findUserByPhone.get(phoneNumber);
      const newAddresses = parseAddresses(updated);

      return res.status(200).json({
        success: true,
        message: 'Address deleted successfully',
        data: {
          profile: {
            phoneNumber: updated.phoneNumber,
            name: updated.name || null,
            addresses: newAddresses,
            defaultAddress: newAddresses.length > 0 ? newAddresses[0] : null
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Delete address error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });
};
