const fs = require('fs');
const path = require('path');
const { getJsonPath } = require('../config/jsonPaths');

const loadProductsFromPath = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load products response', error);
    return null;
  }
};

function hasDiscount(p) {
  const d = p.discount;
  if (d == null || d === '') return false;
  if (typeof d === 'number') return d > 0;
  const n = parseFloat(String(d).replace(/%/g, ''), 10);
  return !Number.isNaN(n) && n > 0;
}

// Ensure client always receives discount and originalPrice on each product
function toClientProduct(p) {
  if (!p) return p;
  return {
    ...p,
    discount: p.discount ?? null,
    originalPrice: p.originalPrice ?? p.price ?? null,
  };
}

// Load from file on each request so admin add/edit/delete is visible immediately (same pattern as stores).
module.exports = function attachProductsRoutes(app, db) {
  // Offers: all products that have a discount (for client "offers" section, like store categories)
  app.get('/api/offers', (req, res) => {
    const productsResponsePath = getJsonPath('products_listing_response.json');
    const productsResponse = loadProductsFromPath(productsResponsePath);
    if (!productsResponse) {
      return res.status(500).json({ success: false, message: 'Products payload is unavailable' });
    }
    const allProducts = (productsResponse?.data?.products ?? []).filter((p) => p.isAvailable !== false);
    const offers = allProducts.filter(hasDiscount).map(toClientProduct);
    return res.status(200).json({
      success: true,
      message: 'Offers (discounted products) retrieved successfully',
      data: { offers, count: offers.length },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/products', (req, res) => {
    const productsResponsePath = getJsonPath('products_listing_response.json');
    const productsResponse = loadProductsFromPath(productsResponsePath);
    if (!productsResponse) {
      return res.status(500).json({
        success: false,
        message: 'Products payload is unavailable'
      });
    }

    const allProducts = (productsResponse?.data?.products ?? []).filter(p => p.isAvailable !== false);
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
    const paginatedProducts = allProducts.slice(startIndex, endIndex).map(toClientProduct);
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
    const productsResponsePath = getJsonPath('products_listing_response.json');
    const productsResponse = loadProductsFromPath(productsResponsePath);
    if (!productsResponse) {
      return res.status(500).json({
        success: false,
        message: 'Products payload is unavailable'
      });
    }

    const products = productsResponse?.data?.products ?? [];
    const product = products.find(p => String(p.id) === String(productId));

    if (product && product.isAvailable === false) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Related products: same store, similar name (exclude self), limit 8
    const storeId = product.store?.id ?? null;
    const productName = (product.nameEn || product.name || product.nameAr || '').toLowerCase();
    const productWords = productName.split(/\s+/).filter(Boolean);
    const related = products
      .filter((p) => String(p.id) !== String(productId) && p.isAvailable !== false)
      .filter((p) => !storeId || (p.store && String(p.store.id) === String(storeId)))
      .map((p) => {
        const name = (p.nameEn || p.name || p.nameAr || '').toLowerCase();
        const matchCount = productWords.filter((w) => w.length > 1 && name.includes(w)).length;
        return { product: p, score: matchCount };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.product);

    return res.status(200).json({
      success: true,
      message: 'Product details retrieved successfully',
      data: {
        product: toClientProduct(product),
        relatedProducts: related.map(toClientProduct),
      },
      timestamp: new Date().toISOString()
    });
  });
};

