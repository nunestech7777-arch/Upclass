import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGoalsFile, previewGoalsCopy, previewGoalsImport, GOALS_FILE_FORMAT } from './goalsIO.ts';
import type { FinanceSeller } from './calc.ts';

const sellers: FinanceSeller[] = [
  { id: 'ana', name: 'Ana', photo_url: null, active: true, show_in_ranking: true },
  { id: 'bia', name: 'Bia', photo_url: null, active: false, show_in_ranking: false },
];

describe('metas de lucro: importação/exportação JSON', () => {
  it('exporta e reimporta sem alterações', () => {
    const goals = [{ seller_id: 'ana', month: '2026-10', profit_target: 100000, worst_case_target: 90000 }];
    const file = JSON.parse(JSON.stringify(buildGoalsFile('2026-10', goals, sellers)));
    const preview = previewGoalsImport(file, '2026-10', sellers, goals);
    assert.deepEqual(preview.errors, []);
    assert.equal(preview.drafts[0].action, 'unchanged');
  });

  it('rejeita formato desconhecido, vendedor inexistente, negativos e pior cenário acima da meta', () => {
    assert.equal(previewGoalsImport({ goals: [] }, '2026-10', sellers, []).errors.length, 1);
    const preview = previewGoalsImport(
      {
        format: GOALS_FILE_FORMAT,
        month: '2026-10',
        goals: [
          { seller_id: 'x', profit_target: 1 },
          { seller_id: 'ana', profit_target: -1 },
          { seller_id: 'bia', profit_target: 100, worst_case_target: 200 },
        ],
      },
      '2026-10',
      sellers,
      []
    );
    assert.equal(preview.errors.length, 3);
    assert.equal(preview.drafts.length, 0);
  });

  it('mostra o que seria sobrescrito, sem decidir sozinho', () => {
    const existing = [{ seller_id: 'ana', month: '2026-11', profit_target: 50000, worst_case_target: null }];
    const preview = previewGoalsImport(
      { format: GOALS_FILE_FORMAT, month: '2026-10', goals: [{ seller_id: 'ana', profit_target: 60000, worst_case_target: null }] },
      '2026-11',
      sellers,
      existing
    );
    assert.equal(preview.drafts[0].action, 'update');
    assert.equal(preview.drafts[0].existing?.profit_target, 50000);
    assert.match(preview.warnings[0], /2026-10/);
  });

  it('cópia do mês anterior avisa sobre vendedor inativo e mês vazio', () => {
    const copy = previewGoalsCopy([{ seller_id: 'bia', month: '2026-09', profit_target: 1, worst_case_target: null }], sellers, []);
    assert.equal(copy.drafts[0].action, 'create');
    assert.match(copy.warnings[0], /inativo/);
    assert.match(previewGoalsCopy([], sellers, []).warnings[0], /não tem metas/);
  });
});

describe('parseMoneyInput', () => {
  it('aceita formatos comuns e sinaliza inválidos', async () => {
    const { parseMoneyInput } = await import('./goalsIO.ts');
    assert.equal(parseMoneyInput('100000'), 100000);
    assert.equal(parseMoneyInput('100000.5'), 100000.5);
    assert.equal(parseMoneyInput('100.000,50'), 100000.5);
    assert.equal(parseMoneyInput('R$ 1.500,00'), 1500);
    assert.equal(parseMoneyInput(''), null);
    assert.ok(Number.isNaN(parseMoneyInput('abc')));
  });
});
