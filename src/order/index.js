const jwt = require('jsonwebtoken');

// Store active order tracking sessions
// Format: { orderId: { driverSocket: socket, customerSocket: socket, lastLocation: {long, lat} } }
const activeTrackings = new Map();

module.exports = function attachOrderTrackingRoutes(io, app, db, authenticateRequest, JWT_SECRET) {
  // Find order by ID
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

    next();
  });

  // WebSocket connection handler
  io.on('connection', (socket) => {
    const { orderId, user } = socket;
    const userId = user.phoneNumber;

    console.log(`WebSocket connection: Order ${orderId}, User ${userId}`);

    // Verify order ownership for customer connections
    // Driver connections are assumed to be authorized (you can add driver verification later)
    const order = findOrderById.get(orderId);
    if (!order) {
      socket.emit('error', { message: 'Order not found' });
      socket.disconnect();
      return;
    }

    // Check if user is customer (order owner)
    const isCustomer = order.userId === userId || order.phoneNumber === userId;
    
    // For now, if not customer, assume it's a driver
    // You can add driver role check here later
    const isDriver = !isCustomer;

    if (isCustomer) {
      // Customer connection
      if (!activeTrackings.has(orderId)) {
        activeTrackings.set(orderId, {
          customerSocket: socket,
          driverSocket: null,
          lastLocation: null,
        });
      } else {
        // Replace existing customer socket
        const tracking = activeTrackings.get(orderId);
        if (tracking.customerSocket) {
          tracking.customerSocket.disconnect();
        }
        tracking.customerSocket = socket;
      }

      socket.join(`order:${orderId}`);
      socket.emit('connected', { 
        role: 'customer', 
        orderId,
        message: 'Connected to order tracking' 
      });

      // Send last known location if available
      const tracking = activeTrackings.get(orderId);
      if (tracking && tracking.lastLocation) {
        socket.emit('location_update', {
          orderId,
          longitude: tracking.lastLocation.longitude,
          latitude: tracking.lastLocation.latitude,
          timestamp: tracking.lastLocation.timestamp,
        });
      }

    } else if (isDriver) {
      // Driver connection
      if (!activeTrackings.has(orderId)) {
        activeTrackings.set(orderId, {
          customerSocket: null,
          driverSocket: socket,
          lastLocation: null,
        });
      } else {
        // Replace existing driver socket
        const tracking = activeTrackings.get(orderId);
        if (tracking.driverSocket) {
          tracking.driverSocket.disconnect();
        }
        tracking.driverSocket = socket;
      }

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
      if (!isDriver) {
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
      const tracking = activeTrackings.get(orderId);
      if (tracking) {
        tracking.lastLocation = {
          longitude,
          latitude,
          timestamp: new Date().toISOString(),
        };

        // Broadcast to customer if connected
        if (tracking.customerSocket) {
          tracking.customerSocket.emit('location_update', {
            orderId,
            longitude,
            latitude,
            timestamp: tracking.lastLocation.timestamp,
          });
        }

        // Also broadcast to room for multiple customer connections
        io.to(`order:${orderId}`).emit('location_update', {
          orderId,
          longitude,
          latitude,
          timestamp: tracking.lastLocation.timestamp,
        });

        socket.emit('location_sent', { 
          success: true,
          message: 'Location updated successfully' 
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`WebSocket disconnect: Order ${orderId}, User ${userId}`);
      
      const tracking = activeTrackings.get(orderId);
      if (tracking) {
        if (isCustomer && tracking.customerSocket === socket) {
          tracking.customerSocket = null;
          // Clean up if no one is tracking
          if (!tracking.driverSocket && !tracking.customerSocket) {
            activeTrackings.delete(orderId);
          }
        } else if (isDriver && tracking.driverSocket === socket) {
          tracking.driverSocket = null;
          // Clean up if no one is tracking
          if (!tracking.driverSocket && !tracking.customerSocket) {
            activeTrackings.delete(orderId);
          }
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
