const jwt = require('jsonwebtoken');
const { verifyAdminToken } = require('../admin/auth');

// Store active order tracking sessions
// Format: { orderId: { driverSocket, customerSocket, adminSockets: [], lastLocation } }
const activeTrackings = new Map();

// Uses the same db and orders table as checkout (creates orders) and admin (lists/updates orders).
module.exports = function attachOrderTrackingRoutes(io, app, db, authenticateRequest, JWT_SECRET) {
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
    return order.userId === userId || order.phoneNumber === userId;
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

    // Determine role: admin, driver, or customer
    const adminPayload = verifyAdminToken(token, JWT_SECRET);
    if (adminPayload && adminPayload.adminId) {
      socket.role = 'admin';
    } else if (user.driverId) {
      socket.role = 'driver';
    } else {
      // Check customer ownership
      const userId = user.phoneNumber;
      if (order.userId === userId || order.phoneNumber === userId) {
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
    const userId = user.phoneNumber || user.adminId || user.driverId;

    console.log(`WebSocket connection: Order ${orderId}, Role ${role}, User ${userId}`);

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
      console.log(`WebSocket disconnect: Order ${orderId}, Role ${role}, User ${userId}`);
      
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

  // REST API endpoint to get current order tracking status
  app.get('/api/orders/:orderId/tracking', authenticateRequest, (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.user.phoneNumber;

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

      const tracking = activeTrackings.get(orderId);
      
      if (!tracking || !tracking.lastLocation) {
        return res.status(200).json({
          success: true,
          message: 'No tracking data available yet',
          data: {
            orderId,
            isTracking: false,
            location: null
          },
          timestamp: new Date().toISOString()
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Tracking data retrieved successfully',
        data: {
          orderId,
          isTracking: true,
          location: {
            longitude: tracking.lastLocation.longitude,
            latitude: tracking.lastLocation.latitude,
            timestamp: tracking.lastLocation.timestamp
          },
          driverConnected: !!tracking.driverSocket,
          customerConnected: !!tracking.customerSocket
        },
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
