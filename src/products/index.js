const fs = require('fs');
const path = require('path');

const productsResponsePath = path.resolve(
  __dirname,
  '..',
  '..',
  'Arheb API JSON',
  'products_listing_response.json'
);

const productDetailsResponsePath = path.resolve(
  __dirname,
  '..',
  '..',
  'Arheb API JSON',
  'product_details_response.json'
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

const loadProductDetailsResponse = () => {
  try {
    const raw = fs.readFileSync(productDetailsResponsePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load product details response', error);
    return null;
  }
};

const productsResponse = loadProductsResponse();
const productDetailsResponse = loadProductDetailsResponse();

module.exports = function attachProductsRoutes(app, db) {
  app.get('/api/products', (req, res) => {
    if (!productsResponse) {
      return res.status(500).json({ 
        success: false,
        message: 'Products payload is unavailable' 
      });
    }

    const allProducts = productsResponse?.data?.products ?? [];
    const totalProducts = allProducts.length;
    
    // Get page parameter, default to 1 if not provided
    const page = parseInt(req.query.page) || 1;
    
    // Validate page number
    if (page < 1) {
      return res.status(400).json({
        success: false,
        message: 'Page number must be greater than 0'
      });
    }

    // Calculate pagination
    const itemsPerPage = 20;
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    
    // Check if start index is beyond available products
    if (startIndex >= totalProducts) {
      return res.status(200).json({
        success: true,
        message: 'No more products available',
        data: {
          products: [],
          pagination: {
            currentPage: page,
            itemsPerPage: itemsPerPage,
            totalProducts: totalProducts,
            totalPages: Math.ceil(totalProducts / itemsPerPage),
            hasMore: false
          }
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get products for current page
    const paginatedProducts = allProducts.slice(startIndex, endIndex);
    const hasMore = endIndex < totalProducts;
    const totalPages = Math.ceil(totalProducts / itemsPerPage);

    return res.status(200).json({
      success: true,
      message: hasMore ? 'Products retrieved successfully' : 'Products retrieved successfully - No more products available',
      data: {
        products: paginatedProducts,
        pagination: {
          currentPage: page,
          itemsPerPage: itemsPerPage,
          totalProducts: totalProducts,
          totalPages: totalPages,
          hasMore: hasMore
        }
      },
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/products/:id', (req, res) => {
    const productId = req.params.id;
    
    if (!productsResponse) {
      return res.status(500).json({ 
        success: false,
        message: 'Products payload is unavailable' 
      });
    }

    // First, try to get detailed product from product_details_response.json
    if (productDetailsResponse?.data?.product) {
      const detailedProduct = productDetailsResponse.data.product;
      if (detailedProduct.id === productId) {
        return res.status(200).json({
          success: true,
          message: 'Product details retrieved successfully',
          data: {
            product: detailedProduct
          },
          timestamp: new Date().toISOString()
        });
      }
    }

    // If detailed product not found, search in products listing
    const products = productsResponse?.data?.products ?? [];
    const product = products.find(p => p.id === productId);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Return product from listing
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

