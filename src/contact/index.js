const { getDriverDeliveryDefaultPercent, normalizeDriverCommissionPercent, getDriverCommissionSettings } = require('../utils/driverCommission');

module.exports = function attachContactRoutes(app, db, authenticateRequest) {
  // Create contact_us table
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_us (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      cliqNumber TEXT,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  try {
    db.exec('ALTER TABLE contact_us ADD COLUMN cliqNumber TEXT');
  } catch (e) { /* column already exists */ }
  try {
    db.exec('ALTER TABLE contact_us ADD COLUMN driverDeliveryPercent REAL');
  } catch (e) { /* column already exists */ }

  // Add dummy data if table is empty
  const checkContactData = db.prepare('SELECT COUNT(*) as count FROM contact_us');
  const contactCount = checkContactData.get();
  
  if (contactCount.count === 0) {
    const insertContact = db.prepare('INSERT INTO contact_us (email, phone, cliqNumber) VALUES (?, ?, ?)');
    insertContact.run('contact@arheb.com', '+201234567890', '');
    console.log('Contact us dummy data inserted');
  }

  // Helper function to check if user is admin
  const checkAdmin = (req, res, next) => {
    const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');
    const user = findUserByPhone.get(req.user.phoneNumber);
    
    if (!user || user.type !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Error not authorized'
      });
    }
    
    next();
  };

  // Get contact us data (includes cliqNumber for app/users)
  app.get('/api/contact', (req, res) => {
    try {
      const getContact = db.prepare(
        'SELECT email, phone, cliqNumber, driverDeliveryPercent FROM contact_us ORDER BY id DESC LIMIT 1',
      );
      const contact = getContact.get();

      if (!contact) {
        return res.status(404).json({
          success: false,
          message: 'Contact information not found'
        });
      }

      const g = getDriverCommissionSettings(db);
      const defaultPct = g.type === 'percent' ? g.value : 0.65;
      const driverDeliveryPercentAppInfo =
        contact.driverDeliveryPercent != null && String(contact.driverDeliveryPercent).trim() !== ''
          ? normalizeDriverCommissionPercent(Number(contact.driverDeliveryPercent), defaultPct)
          : null;

      return res.status(200).json({
        success: true,
        message: 'Contact information retrieved successfully',
        data: {
          contact: {
            email: contact.email,
            phone: contact.phone,
            cliqNumber: contact.cliqNumber != null ? contact.cliqNumber : '',
            driverDeliveryPercent: driverDeliveryPercentAppInfo,
            driverDeliveryDefaultEffective: getDriverDeliveryDefaultPercent(db),
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get contact error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  // Update contact us data (Admin only)
  app.put('/api/contact', authenticateRequest, checkAdmin, (req, res) => {
    try {
      const { email, phone, cliqNumber } = req.body;

      // At least one field must be provided
      if (email === undefined && phone === undefined && cliqNumber === undefined) {
        return res.status(400).json({
          success: false,
          message: 'At least one field (email, phone or cliqNumber) must be provided'
        });
      }

      // Validate email format if provided
      if (email !== undefined) {
        if (typeof email !== 'string' || email.trim() === '') {
          return res.status(400).json({
            success: false,
            message: 'Email must be a valid string'
          });
        }
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid email format'
          });
        }
      }

      // Validate phone format if provided
      if (phone !== undefined) {
        if (typeof phone !== 'string' || phone.trim() === '') {
          return res.status(400).json({
            success: false,
            message: 'Phone must be a valid string'
          });
        }
      }

      if (cliqNumber !== undefined && cliqNumber !== null && typeof cliqNumber !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Cliq number must be a string'
        });
      }

      // Get current contact data
      const getContact = db.prepare('SELECT * FROM contact_us ORDER BY id DESC LIMIT 1');
      const currentContact = getContact.get();

      if (!currentContact) {
        // If no contact data exists, create new record
        const insertContact = db.prepare('INSERT INTO contact_us (email, phone, cliqNumber) VALUES (?, ?, ?)');
        insertContact.run(
          email !== undefined ? email.trim() : 'contact@arheb.com',
          phone !== undefined ? phone.trim() : '+201234567890',
          cliqNumber !== undefined ? String(cliqNumber).trim() : ''
        );
      } else {
        // Update existing record
        const updateContact = db.prepare(`
          UPDATE contact_us 
          SET 
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            cliqNumber = CASE WHEN ? IS NOT NULL THEN ? ELSE cliqNumber END,
            updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        const cliqVal = cliqNumber !== undefined ? String(cliqNumber).trim() : null;
        updateContact.run(
          email !== undefined ? email.trim() : null,
          phone !== undefined ? phone.trim() : null,
          cliqVal,
          cliqVal,
          currentContact.id
        );
      }

      // Prepare success message
      const updatedFields = [];
      if (email !== undefined) updatedFields.push('email');
      if (phone !== undefined) updatedFields.push('phone');
      if (cliqNumber !== undefined) updatedFields.push('cliqNumber');
      
      const successMessage = `Fields updated successfully: ${updatedFields.join(', ')}`;

      // Fetch updated contact data
      const getContactFull = db.prepare('SELECT email, phone, cliqNumber FROM contact_us ORDER BY id DESC LIMIT 1');
      const updatedContact = getContactFull.get();

      return res.status(200).json({
        success: true,
        message: successMessage,
        data: {
          contact: {
            email: updatedContact.email,
            phone: updatedContact.phone,
            cliqNumber: updatedContact.cliqNumber != null ? updatedContact.cliqNumber : ''
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Update contact error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });
};
