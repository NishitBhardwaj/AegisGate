import Fastify from 'fastify';

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
}

const products: Product[] = [
  {
    id: '1',
    name: 'Mechanical Keyboard',
    category: 'electronics',
    price: 3499
  },
  {
    id: '2',
    name: 'Wireless Mouse',
    category: 'electronics',
    price: 1299
  },
  {
    id: '3',
    name: 'System Design Handbook',
    category: 'books',
    price: 899
  }
];

export function buildCatalogApp() {
  const app = Fastify({
    logger: true
  });

  app.get('/health/live', async () => {
    return {
      status: 'ok',
      service: 'catalog-service'
    };
  });

  app.get<{
    Querystring: { category?: string };
  }>('/products', async (request) => {
    const category = request.query.category;

    const filteredProducts = category
      ? products.filter(
          (product) =>
            product.category.toLowerCase() ===
            category.toLowerCase()
        )
      : products;

    return {
      service: 'catalog-service',
      count: filteredProducts.length,
      products: filteredProducts
    };
  });

  app.get<{
    Params: { id: string };
  }>('/products/:id', async (request, reply) => {
    const product = products.find(
      (item) => item.id === request.params.id
    );

    if (!product) {
      return reply.code(404).send({
        error: 'PRODUCT_NOT_FOUND',
        message: 'Product does not exist'
      });
    }

    return {
      service: 'catalog-service',
      product
    };
  });

  return app;
}
