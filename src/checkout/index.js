const fs = require('fs');
const path = require('path');

module.exports = function attachCheckoutRoutes(app, db, authenticateRequest) {
  // Helper function to get storeId from first product if not provided
  const getStoreIdFromProduct = (productId) => {
    try {
      const productsResponsePath = path.resolve(
        __dirname,
        '..',
        '..',
        'Arheb API JSON',
        'products_listing_response.json'
      );
      const raw = fs.readFileSync(productsResponsePath, 'utf-8');
      const productsResponse = JSON.parse(raw);
      const products = productsResponse?.data?.products ?? [];
      const product = products.find(p => p.id === productId);
      return product?.store?.id || null;
    } catch (error) {
      console.error('Failed to get storeId from product:', error);
      return null;
    }
  };
  // Create promo_codes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      value REAL NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

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
      promoCode TEXT,
      orderRating INTEGER DEFAULT 0,
      storeId TEXT,
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

  // Add new columns if they don't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN deliveryFee REAL DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN promoCode TEXT`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN orderRating INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN storeId TEXT`);
  } catch (e) {
    // Column already exists
  }

  const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');
  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const findOrdersByUserId = db.prepare('SELECT * FROM orders WHERE userId = ? OR phoneNumber = ? ORDER BY createdAt DESC');
  
  // Promo code queries
  const findPromoCodeByName = db.prepare('SELECT * FROM promo_codes WHERE name = ?');
  
  // Store rating queries
  const findStoreById = db.prepare('SELECT * FROM store_listings WHERE id = ?');
  const updateStoreRating = db.prepare(`
    UPDATE store_listings 
    SET rate = @newRate, numberOfReviews = @numberOfReviews 
    WHERE id = @storeId
  `);

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
        promoCode,
        storeId,
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

      // Validate and process promo code if provided
      let finalDiscount = discount || 0;
      let finalPromoCode = null;

      if (promoCode) {
        const promoCodeRecord = findPromoCodeByName.get(promoCode.trim());
        if (!promoCodeRecord) {
          return res.status(400).json({
            success: false,
            message: 'invalid promoCode'
          });
        }
        // Use promo code value as discount
        finalDiscount = promoCodeRecord.value;
        finalPromoCode = promoCodeRecord.name;
      } else {
        // Only validate discount if no promo code provided
        if (discount !== undefined && discount !== null && (typeof discount !== 'number' || isNaN(discount))) {
          return res.status(400).json({
            success: false,
            message: 'discount must be a valid number'
          });
        }
        if (discount !== undefined && discount !== null) {
          finalDiscount = discount;
        }
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

      // Get storeId from first product if not provided
      let finalStoreId = storeId;
      if (!finalStoreId && items.length > 0 && items[0].id) {
        finalStoreId = getStoreIdFromProduct(items[0].id);
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
            promoCode,
            orderRating,
            storeId,
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
            @promoCode,
            @orderRating,
            @storeId,
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
          promoCode: orderData.promoCode,
          orderRating: 0,
          storeId: orderData.storeId,
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
        discount: finalDiscount,
        deliveryFee: deliveryFee || 0,
        totalAmount,
        paymentType,
        promoCode: finalPromoCode,
        storeId: finalStoreId,
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
            promoCode: order.promoCode || null,
            orderRating: order.orderRating || 0,
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

  // Get all orders for the authenticated user
  app.get('/api/checkout', authenticateRequest, (req, res) => {
    try {
      const userId = req.user.phoneNumber;

      // Fetch all orders for this user
      const orders = findOrdersByUserId.all(userId, userId);

      // Fetch items for each order
      const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
      
      const ordersWithItems = orders.map(order => {
        const items = findOrderItems.all(order.id);
        return {
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
          promoCode: order.promoCode || null,
          orderRating: order.orderRating || 0,
          nearby: order.nearby,
          notes: order.notes,
          createdAt: order.createdAt,
          items: items.map(item => ({
            id: item.productId,
            name: item.productName,
            price: item.price,
            quantity: item.quantity
          }))
        };
      });

      return res.status(200).json({
        success: true,
        message: 'Orders retrieved successfully',
        data: {
          orders: ordersWithItems,
          count: ordersWithItems.length
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get orders error:', error);
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
            promoCode: order.promoCode || null,
            orderRating: order.orderRating || 0,
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

  // Rate an order
  app.put('/api/checkout/:orderId/rate', authenticateRequest, (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.user.phoneNumber;
      const { rating } = req.body;

      if (isNaN(orderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid order ID'
        });
      }

      // Validate rating
      if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        return res.status(400).json({
          success: false,
          message: 'Rating must be an integer between 1 and 5'
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
          message: "Can't rate this order"
        });
      }

      // Update order rating
      const updateOrderRating = db.prepare('UPDATE orders SET orderRating = ? WHERE id = ?');
      updateOrderRating.run(rating, orderId);

      // If storeId exists, update store rating
      if (order.storeId) {
        const store = findStoreById.get(order.storeId);
        if (store) {
          const oldRate = store.rate || 0;
          const oldNumberOfReviews = store.numberOfReviews || 0;
          
          // Calculate new average rate: (oldRate * oldNumberOfReviews + newRating) / (oldNumberOfReviews + 1)
          const newNumberOfReviews = oldNumberOfReviews + 1;
          const newRate = ((oldRate * oldNumberOfReviews) + rating) / newNumberOfReviews;

          // Update store rating
          updateStoreRating.run({
            newRate: newRate,
            numberOfReviews: newNumberOfReviews,
            storeId: order.storeId
          });
        }
      }

      // Fetch updated order
      const updatedOrder = findOrderById.get(orderId);
      
      // Fetch order items
      const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
      const items = findOrderItems.all(orderId);

      return res.status(200).json({
        success: true,
        message: 'Order rated successfully',
        data: {
          order: {
            id: updatedOrder.id,
            userId: updatedOrder.userId,
            phoneNumber: updatedOrder.phoneNumber,
            name: updatedOrder.name,
            addressName: updatedOrder.addressName,
            addressLong: updatedOrder.addressLong,
            addressLat: updatedOrder.addressLat,
            discount: updatedOrder.discount,
            deliveryFee: updatedOrder.deliveryFee,
            totalAmount: updatedOrder.totalAmount,
            status: updatedOrder.status,
            paymentType: updatedOrder.paymentType,
            promoCode: updatedOrder.promoCode || null,
            orderRating: updatedOrder.orderRating,
            nearby: updatedOrder.nearby,
            notes: updatedOrder.notes,
            createdAt: updatedOrder.createdAt,
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
      console.error('Rate order error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  // Validate/Check promo code
  app.get('/api/promo-codes/:code', (req, res) => {
    try {
      const code = req.params.code;

      if (!code || code.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Promo code is required'
        });
      }

      const promoCodeRecord = findPromoCodeByName.get(code.trim());

      if (!promoCodeRecord) {
        return res.status(404).json({
          success: false,
          message: 'promCode not available'
        });
      }

      return res.status(200).json({
        success: true,
        message: `promocode Value is ${promoCodeRecord.value}`,
        data: {
          value: promoCodeRecord.value,
          name: promoCodeRecord.name
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Validate promo code error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });
};
