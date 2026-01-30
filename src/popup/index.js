const path = require('path');
const fs = require('fs');

const popupJsonPath = path.resolve(
  __dirname,
  '..',
  '..',
  'Arheb API JSON',
  'popup.json'
);

function loadPopup() {
  try {
    const raw = fs.readFileSync(popupJsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load popup.json', e);
    return null;
  }
}

module.exports = function attachPopupRoutes(app) {
  app.get('/api/popup', (req, res) => {
    const data = loadPopup();
    if (data === null) {
      return res.status(500).json({
        success: false,
        message: 'Popup configuration is unavailable'
      });
    }
    return res.status(200).json({
      success: true,
      message: 'Popup retrieved successfully',
      data: {
        popup: {
          image: data.image ?? '',
          call_of_action_button: data.call_of_action_button ?? '',
          destination: data.destination ?? '',
          destination_value: data.destination_value ?? ''
        }
      },
      timestamp: new Date().toISOString()
    });
  });
};
