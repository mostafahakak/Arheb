module.exports = function attachCheckoutRoutes(app, db, authenticateRequest) {
  // Create orders and order_items tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      phoneNumber TEXT NOT NULL,
      name TEXT,
      addressName TEXT,
      addressLong REAL,
      addressLat REAL,
      discount REAL DEFAULT 0,
      deliveryFee REAL DEFAULT 0,
      totalAmount REAL NOT NULL,
      status TEXT DEFAULT 'Waiting confirmation',
      paymentType TEXT NOT NULL,
      nearby TEXT,
      notes TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (phoneNumber) REFERENCES users(phoneNumber)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

  // Add deliveryFee column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN deliveryFee REAL DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }

  const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');
  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');

  // Create order
  app.post('/api/checkout', authenticateRequest, (req, res) => {
    try {
      const userId = req.user.phoneNumber; // Use phoneNumber as userId
      const {
        items,
        name,
        phoneNumber,
        addressName,
        addressLong,
        addressLat,
        discount = 0,
        deliveryFee = 0,
        totalAmount,
        paymentType,
        nearby,
        notes
      } = req.body;

      // Validation
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Items array is required and must not be empty'
        });
      }

      // Validate each item
      for (const item of items) {
        if (!item.id || !item.name || item.price === undefined || !item.quantity) {
          return res.status(400).json({
            success: false,
            message: 'Each item must have id, name, price, and quantity'
          });
        }
      }

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          message: 'phoneNumber is required'
        });
      }

      if (totalAmount === undefined || totalAmount === null) {
        return res.status(400).json({
          success: false,
          message: 'totalAmount is required'
        });
      }

      if (!paymentType) {
        return res.status(400).json({
          success: false,
          message: 'paymentType is required'
        });
      }

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

      // Validate discount, deliveryFee and totalAmount are numbers
      if (typeof discount !== 'number' || isNaN(discount)) {
        return res.status(400).json({
          success: false,
          message: 'discount must be a valid number'
        });
      }

      if (deliveryFee === undefined || deliveryFee === null || typeof deliveryFee !== 'number' || isNaN(deliveryFee)) {
        return res.status(400).json({
          success: false,
          message: 'deliveryFee is required and must be a valid number'
        });
      }

      if (typeof totalAmount !== 'number' || isNaN(totalAmount)) {
        return res.status(400).json({
          success: false,
          message: 'totalAmount must be a valid number'
        });
      }

      // Use transaction to ensure both order and items are created atomically
      const createOrder = db.transaction((orderData) => {
        // Insert order
        const insertOrder = db.prepare(`
          INSERT INTO orders (
            userId,
            phoneNumber,
            name,
            addressName,
            addressLong,
            addressLat,
            discount,
            deliveryFee,
            totalAmount,
            status,
            paymentType,
            nearby,
            notes
          ) VALUES (
            @userId,
            @phoneNumber,
            @name,
            @addressName,
            @addressLong,
            @addressLat,
            @discount,
            @deliveryFee,
            @totalAmount,
            @status,
            @paymentType,
            @nearby,
            @notes
          )
        `);

        const orderResult = insertOrder.run({
          userId: orderData.userId,
          phoneNumber: orderData.phoneNumber,
          name: orderData.name || null,
          addressName: orderData.addressName || null,
          addressLong: orderData.addressLong || null,
          addressLat: orderData.addressLat || null,
          discount: orderData.discount || 0,
          deliveryFee: orderData.deliveryFee || 0,
          totalAmount: orderData.totalAmount,
          status: 'Waiting confirmation',
          paymentType: orderData.paymentType,
          nearby: orderData.nearby || null,
          notes: orderData.notes || null
        });

        const orderId = orderResult.lastInsertRowid;

        // Insert order items
        const insertOrderItem = db.prepare(`
          INSERT INTO order_items (
            orderId,
            productId,
            productName,
            price,
            quantity
          ) VALUES (
            @orderId,
            @productId,
            @productName,
            @price,
            @quantity
          )
        `);

        for (const item of orderData.items) {
          insertOrderItem.run({
            orderId: orderId,
            productId: item.id,
            productName: item.name,
            price: item.price,
            quantity: item.quantity
          });
        }

        return orderId;
      });

      const orderId = createOrder({
        userId,
        phoneNumber,
        name: name || null,
        addressName: addressName || null,
        addressLong: addressLong || null,
        addressLat: addressLat || null,
        discount: discount || 0,
        deliveryFee: deliveryFee || 0,
        totalAmount,
        paymentType,
        nearby: nearby || null,
        notes: notes || null,
        items
      });

      // Fetch the created order
      const order = findOrderById.get(orderId);

      return res.status(201).json({
        success: true,
        message: 'Order created successfully',
        data: {
          orderId: orderId,
          order: {
            id: order.id,
            userId: order.userId,
            phoneNumber: order.phoneNumber,
            name: order.name,
            addressName: order.addressName,
            addressLong: order.addressLong,
            addressLat: order.addressLat,
            discount: order.discount,
            deliveryFee: order.deliveryFee,
            totalAmount: order.totalAmount,
            status: order.status,
            paymentType: order.paymentType,
            nearby: order.nearby,
            notes: order.notes,
            createdAt: order.createdAt,
            items: items
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Checkout error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  // Get order by ID (optional - for retrieving order details)
  app.get('/api/checkout/:orderId', authenticateRequest, (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.user.phoneNumber;

      if (isNaN(orderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid order ID'
        });
      }

      const order = findOrderById.get(orderId);

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      // Verify the order belongs to the authenticated user
      if (order.userId !== userId && order.phoneNumber !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Fetch order items
      const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
      const items = findOrderItems.all(orderId);

      return res.status(200).json({
        success: true,
        message: 'Order retrieved successfully',
        data: {
          order: {
            id: order.id,
            userId: order.userId,
            phoneNumber: order.phoneNumber,
            name: order.name,
            addressName: order.addressName,
            addressLong: order.addressLong,
            addressLat: order.addressLat,
            discount: order.discount,
            deliveryFee: order.deliveryFee,
            totalAmount: order.totalAmount,
            status: order.status,
            paymentType: order.paymentType,
            nearby: order.nearby,
            notes: order.notes,
            createdAt: order.createdAt,
            items: items.map(item => ({
              id: item.productId,
              name: item.productName,
              price: item.price,
              quantity: item.quantity
            }))
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get order error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });
};
