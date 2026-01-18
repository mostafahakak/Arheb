module.exports = function attachProfileRoutes(app, db, authenticateRequest) {
  const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');

  // Get user profile
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

      return res.status(200).json({
        success: true,
        message: 'Profile retrieved successfully',
        data: {
          profile: {
            phoneNumber: user.phoneNumber,
            name: user.name || null,
            addressName: user.addressName || null,
            addressLong: user.addressLong || null,
            addressLat: user.addressLat || null
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

  // Update user profile
  app.put('/api/profile', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const { name, addressName, addressLong, addressLat } = req.body;

      // Validate coordinates if provided
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

      // Build update query dynamically based on provided fields
      const updates = [];
      const values = {};

      if (name !== undefined) {
        updates.push('name = @name');
        values.name = name || null;
      }
      if (addressName !== undefined) {
        updates.push('addressName = @addressName');
        values.addressName = addressName || null;
      }
      if (addressLong !== undefined) {
        updates.push('addressLong = @addressLong');
        values.addressLong = addressLong || null;
      }
      if (addressLat !== undefined) {
        updates.push('addressLat = @addressLat');
        values.addressLat = addressLat || null;
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }

      values.phoneNumber = phoneNumber;
      const updateQuery = `UPDATE users SET ${updates.join(', ')} WHERE phoneNumber = @phoneNumber`;
      const updateUser = db.prepare(updateQuery);
      updateUser.run(values);

      // Fetch updated user
      const user = findUserByPhone.get(phoneNumber);

      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          profile: {
            phoneNumber: user.phoneNumber,
            name: user.name || null,
            addressName: user.addressName || null,
            addressLong: user.addressLong || null,
            addressLat: user.addressLat || null
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
};
