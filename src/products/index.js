const fs = require('fs');
const path = require('path');

const productsResponsePath = path.resolve(
  __dirname,
  '..',
  '..',
  'Arheb API JSON',
  'products_listing_response.json'
);

const loadProductsResponse = () => {
  try {
    const raw = fs.readFileSync(productsResponsePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load products response', error);
    return null;
  }
};

const productsResponse = loadProductsResponse();

module.exports = function attachProductsRoutes(app, db) {
  app.get('/api/products', (req, res) => {
    if (!productsResponse) {
      return res.status(500).json({ message: 'Products payload is unavailable' });
    }

    return res.status(200).json(productsResponse);
  });

  app.get('/api/products/:id', (req, res) => {
    const productId = req.params.id;
    
    if (!productsResponse) {
      return res.status(500).json({ message: 'Products payload is unavailable' });
    }

    // Find product by ID from the products listing
    const products = productsResponse?.data?.products ?? [];
    const product = products.find(p => p.id === productId);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Return product details in the standard format
    return res.status(200).json({
      success: true,
      message: 'Product details retrieved successfully',
      data: {
        product: product
      },
      timestamp: new Date().toISOString()
    });
  });
};

