import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { 
  classifyProductCategory, 
  isDeviceProduct, 
  isCountableAccessorySale, 
  isCountableSale 
} from './productClassifier.ts';

describe('classifyProductCategory - Classificação Oficial de Produtos', () => {
  it('deve classificar IPHONE 11 - 128GB - BRANCO como Aparelhos', () => {
    assert.equal(classifyProductCategory('IPHONE 11 - 128GB - BRANCO'), 'Aparelhos');
  });

  it('deve classificar IPHONE 18 PRO MAX - 256GB - BURGUNDY como Aparelhos', () => {
    assert.equal(classifyProductCategory('IPHONE 18 PRO MAX - 256GB - BURGUNDY'), 'Aparelhos');
  });

  it('deve classificar IPHONE 13 PRO - 256GB - AZUL como Aparelhos', () => {
    assert.equal(classifyProductCategory('IPHONE 13 PRO - 256GB - AZUL'), 'Aparelhos');
  });

  it('deve classificar IPAD 11 - 128GB - SILVER como Acessórios', () => {
    assert.equal(classifyProductCategory('IPAD 11 - 128GB - SILVER'), 'Acessórios');
  });

  it('deve classificar WATCH S11 APPLE - 42MM - SILVER como Acessórios', () => {
    assert.equal(classifyProductCategory('WATCH S11 APPLE - 42MM - SILVER'), 'Acessórios');
  });

  it('deve classificar AIRPODS PRO como Acessórios', () => {
    assert.equal(classifyProductCategory('AIRPODS PRO'), 'Acessórios');
  });

  it('deve classificar CAPA IPHONE 14 como Acessórios (contém iPhone no meio, mas não começa com iPhone)', () => {
    assert.equal(classifyProductCategory('CAPA IPHONE 14'), 'Acessórios');
  });

  it('deve classificar PELÍCULA IPHONE 15 como Acessórios', () => {
    assert.equal(classifyProductCategory('PELÍCULA IPHONE 15'), 'Acessórios');
  });

  it('deve lidar corretamente com espaços e maiúsculas/minúsculas', () => {
    assert.equal(classifyProductCategory('  iphone 15 pro max  '), 'Aparelhos');
    assert.equal(classifyProductCategory('  Iphone 12  '), 'Aparelhos');
    assert.equal(classifyProductCategory(''), 'Acessórios');
    assert.equal(classifyProductCategory(null), 'Acessórios');
    assert.equal(classifyProductCategory(undefined), 'Acessórios');
  });
});

describe('isCountableAccessorySale - Regra de Acessórios Pagos vs Brindes R$ 0,00', () => {
  it('não deve contar acessório com valor 0 (brinde/cortesia)', () => {
    assert.equal(isCountableAccessorySale({ amount: 0, quantity: 1 }, 'PELICULA VIDRO 3D - BND'), false);
    assert.equal(isCountableAccessorySale({ amount: '0.00', quantity: 1 }, 'CAPA TRANSPARENTE'), false);
    assert.equal(isCountableAccessorySale({ amount: null, quantity: 1 }, 'CARREGADOR COMPLETO'), false);
  });

  it('deve contar acessório pago com valor > 0', () => {
    assert.equal(isCountableAccessorySale({ amount: 30, quantity: 1 }, 'PELICULA VIDRO 3D'), true);
    assert.equal(isCountableAccessorySale({ amount: 150, quantity: 1 }, 'FONTE TURBO 65W'), true);
    assert.equal(isCountableAccessorySale({ amount: 2500, quantity: 1 }, 'APPLE WATCH ULTRA'), true);
  });

  it('não deve contar aparelho como acessório mesmo se tiver valor > 0', () => {
    assert.equal(isCountableAccessorySale({ amount: 7000, quantity: 1 }, 'iPhone 17 Pro Max'), false);
  });
});

describe('isCountableSale - Contabilização Geral', () => {
  it('iPhone sempre conta como venda válida', () => {
    assert.equal(isCountableSale({ amount: 7000, quantity: 1 }, 'iPhone 17 Pro Max'), true);
    assert.equal(isCountableSale({ amount: 0, quantity: 1 }, 'iPhone 16'), true);
  });

  it('Acessório com valor 0 é rejeitado na contagem geral', () => {
    assert.equal(isCountableSale({ amount: 0, quantity: 1 }, 'Película 3D'), false);
  });

  it('Acessório com valor > 0 é aceito na contagem geral', () => {
    assert.equal(isCountableSale({ amount: 49.9, quantity: 1 }, 'Película 3D'), true);
  });
});

describe('iPhones cadastrados sem a palavra "iPhone" (nomes reais do Mercado Phone)', () => {
  it('reconhece modelo + capacidade como Aparelhos', () => {
    for (const n of ['15 PLUS - 128 GB - PINK', '15 PLUS - 512 GB - GREEN', 'CASE MAGSAFE 15 PRO MAX - 256 GB - NATURAL', '13 PRO MAX - 256GB - GRAFITE']) {
      assert.equal(classifyProductCategory(n), 'Aparelhos', n);
      assert.equal(isCountableAccessorySale({ amount: 4000 }, n), false, n);
    }
  });
  it('não confunde com acessórios, outros Apple ou Android', () => {
    for (const n of ['CAPA 15 PRO MAX', 'PELICULA 15 PLUS', 'IPAD 11 - 128 GB - SILVER', 'MACBOOK AIR M1 13 - 256GB', 'APPLE WATCH S10 42MM', 'POCO X7 - 256 GB', 'REDMI NOTE 13 - 256GB', 'GALAXY A15 128GB', 'CARTAO DE MEMORIA 64GB', '15 PLUS']) {
      assert.equal(classifyProductCategory(n), 'Acessórios', n);
    }
  });
});
