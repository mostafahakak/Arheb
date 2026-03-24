const jwt = require('jsonwebtoken');
const { verifyAdminToken } = require('../admin/auth');
const { setOrderTrackingIo, emitOrderEvent } = require('./trackingEmitter');
const { mapOrderItemsRows } = require('../utils/orderItemApi');

// Store active order tracking sessions
// Format: { orderId: { driverSocket, customerSocket, adminSockets: [], lastLocation } }
const activeTrackings = new Map();

/**
 * When a driver sends location on /driver-presence (not the order socket), push updates to all
 * active "On the way" orders for that driver so customer/admin maps stay live.
 */
function broadcastDriverPresenceLocation(io, db, driverId, latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || isNaN(latitude) || isNaN(longitude)) return;
  let rows;
  try {
    rows = db.prepare("SELECT id FROM orders WHERE driverId = ? AND status = 'On the way'").all(driverId);
  } catch (e) {
    return;
  }
  const ts = new Date().toISOString();
  for (const row of rows) {
    const orderId = row.id;
    if (!activeTrackings.has(orderId)) {
      activeTrackings.set(orderId, {
        customerSocket: null,
        driverSocket: null,
        adminSockets: [],
        lastLocation: null,
      });
    }
    const t = activeTrackings.get(orderId);
    t.lastLocation = { longitude, latitude, timestamp: ts };
    io.to(`order:${orderId}`).emit('location_update', {
      orderId,
      longitude,
      latitude,
      timestamp: ts,
    });
  }
}

// Uses the same db and orders table as checkout (creates orders) and admin (lists/updates orders).
module.exports = function attachOrderTrackingRoutes(io, app, db, authenticateRequest, JWT_SECRET) {
  setOrderTrackingIo(io);
  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');

  // Helper function to verify token and get user info
  function verifyToken(token) {
    try {
      const cleanToken = token.replace('Bearer ', '').trim();
      return jwt.verify(cleanToken, JWT_SECRET);
    } catch (error) {
      return null;
    }
  }

  // Helper function to verify order ownership (for customer)
  function verifyOrderOwnership(orderId, userId) {
    const order = findOrderById.get(orderId);
    if (!order) return false;
    return order.userId === userId;
  }

  // WebSocket connection middleware for authentication
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
    const orderId = socket.handshake.auth.orderId;

    if (!token || !orderId) {
      return next(new Error('Authentication failed: Token and orderId are required'));
    }

    const user = verifyToken(token);
    if (!user) {
      return next(new Error('Authentication failed: Invalid token'));
    }

    socket.user = user;
    socket.orderId = parseInt(orderId);
    
    // Verify order exists
    const order = findOrderById.get(socket.orderId);
    if (!order) {
      return next(new Error('Order not found'));
    }

    // Determine role: admin, driver, or customer (with access checks)
    const adminPayload = verifyAdminToken(token, JWT_SECRET);
    if (adminPayload && adminPayload.adminId) {
      if (adminPayload.role === 'store_admin') {
        if (order.storeId != null && order.storeId !== adminPayload.storeId) {
          return next(new Error('Access denied: You can only track orders for your store'));
        }
      }
      socket.role = 'admin';
      socket.adminPayload = adminPayload;
    } else if (user.driverId) {
      if (order.driverId != null && order.driverId !== user.driverId) {
        return next(new Error('Access denied: You can only track orders assigned to you'));
      }
      socket.role = 'driver';
    } else {
      // Check customer ownership (JWT may include userId for new accounts; phoneNumber always present)
      const userId = user.userId || user.phoneNumber;
      if (order.userId === userId || order.phoneNumber === user.phoneNumber) {
        socket.role = 'customer';
      } else {
        return next(new Error('Unauthorized: You are not authorized to track this order'));
      }
    }

    next();
  });

  // WebSocket connection handler
  io.on('connection', (socket) => {
    const { orderId, user, role } = socket;
    const logId = role === 'customer' ? (user.userId || user.phoneNumber) : user.driverId || user.phoneNumber || user.adminId;

    console.log(`WebSocket connection: Order ${orderId}, Role ${role}, User ${logId}`);

    const order = findOrderById.get(orderId);
    if (!order) {
      socket.emit('error', { message: 'Order not found' });
      socket.disconnect();
      return;
    }

    // Initialize tracking entry if not exists
    if (!activeTrackings.has(orderId)) {
      activeTrackings.set(orderId, {
        customerSocket: null,
        driverSocket: null,
        adminSockets: [],
        lastLocation: null,
      });
    }

    const tracking = activeTrackings.get(orderId);

    if (role === 'admin') {
      // Admin observer connection
      tracking.adminSockets.push(socket);
      socket.join(`order:${orderId}`);
      socket.emit('connected', {
        role: 'admin',
        orderId,
        message: 'Connected as admin observer',
      });
      // Send last known location if available
      if (tracking.lastLocation) {
        socket.emit('location_update', {
          orderId,
          longitude: tracking.lastLocation.longitude,
          latitude: tracking.lastLocation.latitude,
          timestamp: tracking.lastLocation.timestamp,
        });
      }
    } else if (role === 'customer') {
      // Customer connection
      if (tracking.customerSocket) {
        tracking.customerSocket.disconnect();
      }
      tracking.customerSocket = socket;
      socket.join(`order:${orderId}`);
      socket.emit('connected', { 
        role: 'customer', 
        orderId,
        message: 'Connected to order tracking' 
      });
      // Send last known location if available
      if (tracking.lastLocation) {
        socket.emit('location_update', {
          orderId,
          longitude: tracking.lastLocation.longitude,
          latitude: tracking.lastLocation.latitude,
          timestamp: tracking.lastLocation.timestamp,
        });
      }
    } else if (role === 'driver') {
      // Driver connection
      if (tracking.driverSocket) {
        tracking.driverSocket.disconnect();
      }
      tracking.driverSocket = socket;
      socket.join(`order:${orderId}`);
      socket.emit('connected', { 
        role: 'driver', 
        orderId,
        message: 'Connected as driver' 
      });
    } else {
      socket.emit('error', { message: 'Unauthorized: You are not authorized to track this order' });
      socket.disconnect();
      return;
    }

    // Handle driver location updates
    socket.on('driver_location', (data) => {
      if (role !== 'driver') {
        socket.emit('error', { message: 'Only drivers can send location updates' });
        return;
      }

      const { longitude, latitude } = data;

      if (typeof longitude !== 'number' || typeof latitude !== 'number' ||
          isNaN(longitude) || isNaN(latitude)) {
        socket.emit('error', { message: 'Invalid coordinates' });
        return;
      }

      // Update last known location
      const t = activeTrackings.get(orderId);
      if (t) {
        t.lastLocation = {
          longitude,
          latitude,
          timestamp: new Date().toISOString(),
        };

        // Broadcast to room (customers + admins)
        io.to(`order:${orderId}`).emit('location_update', {
          orderId,
          longitude,
          latitude,
          timestamp: t.lastLocation.timestamp,
        });

        socket.emit('location_sent', { 
          success: true,
          message: 'Location updated successfully' 
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`WebSocket disconnect: Order ${orderId}, Role ${role}, User ${logId}`);
      
      const t = activeTrackings.get(orderId);
      if (t) {
        if (role === 'customer' && t.customerSocket === socket) {
          t.customerSocket = null;
        } else if (role === 'driver' && t.driverSocket === socket) {
          t.driverSocket = null;
        } else if (role === 'admin') {
          t.adminSockets = t.adminSockets.filter((s) => s !== socket);
        }
        // Clean up if no one is tracking
        if (!t.driverSocket && !t.customerSocket && t.adminSockets.length === 0) {
          activeTrackings.delete(orderId);
        }
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      socket.emit('error', { message: error.message || 'An error occurred' });
    });
  });

  // REST API: customer get order by ID with live status (for order tracking screen)
  app.get('/api/orders/:orderId', authenticateRequest, (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.user.userId || req.user.phoneNumber;
      if (isNaN(orderId)) {
        return res.status(400).json({ success: false, message: 'Invalid order ID' });
      }
      const order = findOrderById.get(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
      if (order.userId !== userId) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
      const items = findOrderItems.all(orderId);
      let driverPhone = null;
      if (order.driverId != null) {
        try {
          const dr = db.prepare('SELECT mobile FROM drivers WHERE id = ?').get(order.driverId);
          driverPhone = dr?.mobile ?? null;
        } catch (e) { /* ignore */ }
      }
      const serviceFee = order.serviceFee != null ? Number(order.serviceFee) : 0.65;
      const feesTax =
        order.feesTax != null
          ? Number(order.feesTax)
          : Math.round(((0.16 * ((Number(order.deliveryFee) || 0) + (Number(serviceFee) || 0))) + Number.EPSILON) * 100) / 100;
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
            serviceFee,
            feesTax,
            weightKg: order.weightKg != null ? Number(order.weightKg) : 0,
            totalAmount: order.totalAmount,
            orderSummary: {
              currency: 'JOD',
              orderValue: Math.round(((Number(order.totalAmount) || 0) + Number.EPSILON) * 100) / 100,
              deliveryFee: Math.round(((Number(order.deliveryFee) || 0) + Number.EPSILON) * 100) / 100,
              serviceFee: Math.round(((Number(serviceFee) || 0) + Number.EPSILON) * 100) / 100,
              feesTaxRate: 0.16,
              feesTax: Math.round(((Number(feesTax) || 0) + Number.EPSILON) * 100) / 100,
              total: Math.round((((Number(order.totalAmount) || 0) + (Number(order.deliveryFee) || 0) + (Number(serviceFee) || 0) + (Number(feesTax) || 0)) + Number.EPSILON) * 100) / 100,
            },
            invoice: {
              currency: 'JOD',
              deliveryFee: Math.round(((Number(order.deliveryFee) || 0) + Number.EPSILON) * 100) / 100,
              serviceFee: Math.round(((Number(serviceFee) || 0) + Number.EPSILON) * 100) / 100,
              feesTaxRate: 0.16,
              feesTax: Math.round(((Number(feesTax) || 0) + Number.EPSILON) * 100) / 100,
              total: Math.round((((Number(order.deliveryFee) || 0) + (Number(serviceFee) || 0) + (Number(feesTax) || 0)) + Number.EPSILON) * 100) / 100,
            },
            status: order.status,
            storeId: order.storeId ?? null,
            driverId: order.driverId ?? null,
            driverName: order.driverName ?? null,
            driverPhone,
            paymentType: order.paymentType,
            promoCode: order.promoCode || null,
            orderRating: order.orderRating || 0,
            nearby: order.nearby,
            notes: order.notes,
            paymentVerificationImage: order.paymentVerificationImage || null,
            createdAt: order.createdAt,
            items: mapOrderItemsRows(items),
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get order error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // REST API endpoint to get current order tracking status (includes live order status)
  app.get('/api/orders/:orderId/tracking', authenticateRequest, (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.user.userId || req.user.phoneNumber;

      if (isNaN(orderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid order ID'
        });
      }

      // Verify order ownership
      if (!verifyOrderOwnership(orderId, userId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const order = findOrderById.get(orderId);
      const tracking = activeTrackings.get(orderId);
      let driverPhone = null;
      if (order && order.driverId != null) {
        try {
          const dr = db.prepare('SELECT mobile FROM drivers WHERE id = ?').get(order.driverId);
          driverPhone = dr?.mobile ?? null;
        } catch (e) { /* ignore */ }
      }
      const baseData = {
        orderId,
        status: order ? order.status : null,
        driverPhone,
        isTracking: !!(tracking && tracking.lastLocation),
        location: (tracking && tracking.lastLocation) ? {
          longitude: tracking.lastLocation.longitude,
          latitude: tracking.lastLocation.latitude,
          timestamp: tracking.lastLocation.timestamp
        } : null,
        driverConnected: !!(tracking && tracking.driverSocket),
        customerConnected: !!(tracking && tracking.customerSocket)
      };

      if (!tracking || !tracking.lastLocation) {
        return res.status(200).json({
          success: true,
          message: 'No tracking data available yet',
          data: baseData,
          timestamp: new Date().toISOString()
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Tracking data retrieved successfully',
        data: baseData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get tracking status error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });
};

module.exports.emitOrderEvent = emitOrderEvent;
module.exports.getOrderTrackingState = (orderId) => activeTrackings.get(orderId);
module.exports.broadcastDriverPresenceLocation = broadcastDriverPresenceLocation;
