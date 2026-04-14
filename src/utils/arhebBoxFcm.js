/**
 * FCM data payloads for Arheb Box — mirror store order customer notifications (order_tracking + deep link).
 */

const fcm = require('../fcm');

function arhebDebugEnabled() {
  const v = process.env.ARHEB_DEBUG;
  return v === '1' || String(v).toLowerCase() === 'true';
}

function logArhebDebug(tag, payload) {
  const line = { tag, ...payload, t: new Date().toISOString() };
  console.log('[arheb-debug]', JSON.stringify(line));
}

function customerArhebBoxTrackingData(requestId, status) {
  const id = String(requestId);
  return {
    orderId: id,
    requestId: id,
    status: String(status || ''),
    type: 'order_tracking',
    orderType: 'arheb_box',
    screen: 'arheb_box_details',
    deepLink: `arheb://arheb-box/${id}`,
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
  };
}

/**
 * Customer push: box request was created (cash/direct API or after card payment finalization).
 * Uses row.fcmToken from the request when set; otherwise users.fcmToken via phone.
 */
function notifyArhebBoxCustomerRequestReceived(db, row) {
  if (!db || !row || row.id == null) return;
  const id = row.id;
  const payload = customerArhebBoxTrackingData(id, row.status || 'pending');
  const title = 'Arheb Box';
  const body = `Your request #${id} was received. We're finding a driver.`;
  const hasBoxTok = !!(row.fcmToken && String(row.fcmToken).trim());
  if (arhebDebugEnabled()) {
    logArhebDebug('customer_request_received', {
      requestId: id,
      hasBoxFcmToken: hasBoxTok,
      phone: row.phoneNumber ? String(row.phoneNumber).slice(0, 4) + '…' : null,
    });
  }
  if (hasBoxTok) {
    fcm
      .sendToToken(row.fcmToken, title, body, null, payload, { db })
      .then((mid) => {
        if (arhebDebugEnabled()) logArhebDebug('customer_fcm_token_ok', { requestId: id, messageId: mid || null });
      })
      .catch((e) => {
        console.warn('[arheb-fcm] customer token send failed:', e?.message || e);
        fcm.sendToUserByPhone(db, row.phoneNumber, title, body, null, payload).catch((e2) => {
          console.warn('[arheb-fcm] customer phone fallback failed:', e2?.message || e2);
        });
      });
    return;
  }
  fcm.sendToUserByPhone(db, row.phoneNumber, title, body, null, payload).catch((e) => {
    console.warn('[arheb-fcm] customer sendToUserByPhone failed:', e?.message || e);
  });
}

/** Customer push when a driver accepts / is en route to pickup (in_progress). */
function notifyArhebBoxCustomerDriverEnRoute(db, row, requestId) {
  if (!db || !row || requestId == null) return;
  const id = requestId;
  const payload = customerArhebBoxTrackingData(id, 'in_progress');
  const title = 'Driver on the way';
  const body = `A driver is heading to pick up your Arheb Box request #${id}. Track live in the app.`;
  const hasBoxTok = !!(row.fcmToken && String(row.fcmToken).trim());
  if (arhebDebugEnabled()) {
    logArhebDebug('customer_driver_en_route', {
      requestId: id,
      hasBoxFcmToken: hasBoxTok,
      phone: row.phoneNumber ? String(row.phoneNumber).slice(0, 4) + '…' : null,
    });
  }
  if (hasBoxTok) {
    fcm
      .sendToToken(row.fcmToken, title, body, null, payload, { db })
      .then((mid) => {
        if (arhebDebugEnabled()) logArhebDebug('customer_driver_en_route_token', { requestId: id, messageId: mid || null });
        if (!mid) {
          return fcm.sendToUserByPhone(db, row.phoneNumber, title, body, null, payload);
        }
      })
      .catch((e) => {
        console.warn('[arheb-fcm] driver en route token send failed:', e?.message || e);
        return fcm.sendToUserByPhone(db, row.phoneNumber, title, body, null, payload).catch((e2) => {
          console.warn('[arheb-fcm] driver en route phone fallback failed:', e2?.message || e2);
        });
      });
    return;
  }
  fcm.sendToUserByPhone(db, row.phoneNumber, title, body, null, payload).catch((e) => {
    console.warn('[arheb-fcm] driver en route sendToUserByPhone failed:', e?.message || e);
  });
}

module.exports = {
  customerArhebBoxTrackingData,
  notifyArhebBoxCustomerRequestReceived,
  notifyArhebBoxCustomerDriverEnRoute,
  arhebDebugEnabled,
  logArhebDebug,
};
