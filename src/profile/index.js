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

  // Update user profile (name only)
  app.put('/api/profile', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const { name } = req.body || {};

      if (name === undefined) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }

      const updateUser = db.prepare('UPDATE users SET name = @name WHERE phoneNumber = @phoneNumber');
      updateUser.run({ name: name || null, phoneNumber });

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
